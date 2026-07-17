type RingBufferAudioLike = {
	getReadIndex(): number;
	getCapacity(): number;
	getDataView(): Float32Array;
};

type VisualizerOptions = {
	channels?: number; // interleaved channel count
	channel?: number | 'mix'; // which channel to meter, or mix
	windowFrames?: number; // how many frames to analyze per update
	maxFps?: number;

	// ballistics
	attackMs?: number; // how fast needle rises
	releaseMs?: number; // how fast needle falls

	// meter calibration
	floorDb?: number; // dB mapped to 0
	ceilingDb?: number; // dB mapped to 1
};

export class AnalogVUMeter {
	private rafId: number | null = null;

	private vu = 0;

	private readonly canvas: HTMLCanvasElement;
	private readonly rb: RingBufferAudioLike;
	private readonly opts: VisualizerOptions = {};

	constructor(
		canvas: HTMLCanvasElement,
		rb: RingBufferAudioLike,
		opts: VisualizerOptions = {}
	) {
		this.canvas = canvas;
		this.rb = rb;
		this.opts = opts;
	}

	start() {
		if (this.rafId != null) return;
		const tick = (t: number) => {
			this.rafId = requestAnimationFrame(tick);
			const maxFps = this.opts.maxFps ?? 60;
			const minDt = 1000 / maxFps;

			if ((tick as any)._last && t - (tick as any)._last < minDt) return;
			(tick as any)._last = t;

			this.updateAndDraw(t);
		};
		this.rafId = requestAnimationFrame(tick);
	}

	stop() {
		if (this.rafId != null) cancelAnimationFrame(this.rafId);
		this.rafId = null;
	}

	private updateAndDraw(nowMs: number) {
		const ctx = this.canvas.getContext('2d');
		if (!ctx) return;

		// HiDPI support
		const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
		const cssW = this.canvas.clientWidth || this.canvas.width;
		const cssH = this.canvas.clientHeight || this.canvas.height;

		if (
			this.canvas.width !== cssW * dpr ||
			this.canvas.height !== cssH * dpr
		) {
			this.canvas.width = cssW * dpr;
			this.canvas.height = cssH * dpr;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const w = cssW;
		const h = cssH;

		const channels = this.opts.channels ?? 2;
		const which = this.opts.channel ?? 'mix';

		const cap = this.rb.getCapacity();
		const data = this.rb.getDataView();

		const r = this.rb.getReadIndex();

		const windowFrames = this.opts.windowFrames ?? 256;
		const windowSamples = windowFrames * channels;

		const rms = this.computeRmsWindow(
			data,
			cap,
			r,
			windowSamples,
			channels,
			which
		);

		// Convert to dBFS
		const db = ampToDb(rms);

		// Map dB to 0..1 needle range
		const floorDb = this.opts.floorDb ?? -60;
		const ceilDb = this.opts.ceilingDb ?? 0;
		const target = clamp01((db - floorDb) / (ceilDb - floorDb));

		// Ballistics (attack/release)
		const attackMs = this.opts.attackMs ?? 25;
		const releaseMs = this.opts.releaseMs ?? 250;

		const dt = 1000 / (this.opts.maxFps ?? 60);

		const aUp = 1 - Math.exp(-dt / attackMs);
		const aDown = 1 - Math.exp(-dt / releaseMs);

		if (target > this.vu) this.vu = lerp(this.vu, target, aUp);
		else this.vu = lerp(this.vu, target, aDown);

		this.drawMeter(ctx, w, h, this.vu, db);
	}

	private computeRmsWindow(
		data: Float32Array,
		cap: number,
		readIndex: number,
		windowSamples: number,
		channels: number,
		which: number | 'mix'
	): number {
		let sumSq = 0;
		let count = 0;

		const ws = Math.min(windowSamples, cap);
		const start = readIndex - ws;

		if (which === 'mix') {
			for (let i = 0; i < ws; i++) {
				const idx = mod(start + i, cap);
				const x = data[idx];
				sumSq += x * x;
			}
			count = ws;
		} else {
			const ch = which | 0;
			if (ch < 0 || ch >= channels) return 0;

			const startSample = start;
			let first = startSample;

			const m = mod(first, channels);
			const delta = mod(ch - m, channels);
			first += delta;

			for (let s = first; s < readIndex; s += channels) {
				const idx = mod(s, cap);
				const x = data[idx];
				sumSq += x * x;
				count++;
			}
		}

		if (count <= 0) return 0;
		return Math.sqrt(sumSq / count);
	}

	private drawMeter(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		vu: number,
		db: number
	) {
		// Background
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = '#0b0f17';
		ctx.fillRect(0, 0, w, h);

		const radius = w / 2;
		const cx = w / 2;
		const cy = radius + 30;

		// Meter arc
		const aMin = deg(-50 + 90);
		const aMax = deg(50 + 90);

		// Draw arc + ticks
		ctx.lineWidth = 2;
		ctx.strokeStyle = '#2a3344';
		ctx.beginPath();
		ctx.arc(cx, cy, radius, Math.PI + aMin, Math.PI + aMax, false);
		ctx.stroke();

		// Ticks and labels
		ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.fillStyle = '#e7edf8';
		ctx.strokeStyle = '#3b465c';
		ctx.lineWidth = 1;

		const tickValsDb = [-60, -40, -30, -20, -10, -6, -3, 0];
		const floorDb = this.opts.floorDb ?? -60;
		const ceilDb = this.opts.ceilingDb ?? 0;

		for (const tdb of tickValsDb) {
			const frac = clamp01((tdb - floorDb) / (ceilDb - floorDb));
			const ang = lerp(aMin, aMax, frac);
			this.drawTick(ctx, cx, cy, radius, ang, tdb === 0 ? 12 : 8);
			const lx = cx + Math.cos(Math.PI + ang) * (radius - 26);
			const ly = cy + Math.sin(Math.PI + ang) * (radius - 26);
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(tdb.toString(), lx, ly);
		}

		// Needle
		const needleAng = lerp(aMin, aMax, vu);
		const nx = cx + Math.cos(Math.PI + needleAng) * (radius - 10);
		const ny = cy + Math.sin(Math.PI + needleAng) * (radius - 10);

		ctx.strokeStyle = '#4f7cff';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(nx, ny);
		ctx.stroke();

		// ctx.fillStyle = '#e7edf8';
		// ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		// ctx.textAlign = 'center';
		// ctx.fillText(`${isFinite(db) ? db.toFixed(1) : '-∞'} dB`, cx, h * 0.13);
	}

	private drawTick(
		ctx: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		radius: number,
		ang: number,
		len: number
	) {
		const a = Math.PI + ang;
		const x0 = cx + Math.cos(a) * (radius - len);
		const y0 = cy + Math.sin(a) * (radius - len);
		const x1 = cx + Math.cos(a) * radius;
		const y1 = cy + Math.sin(a) * radius;

		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.lineTo(x1, y1);
		ctx.stroke();
	}
}

function ampToDb(a: number) {
	// dBFS: 20*log10(a). Clamp very small values to avoid -Inf
	const eps = 1e-12;
	const x = Math.max(eps, a);
	return 20 * Math.log10(x);
}

function clamp01(x: number) {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function deg(d: number) {
	return (d * Math.PI) / 180;
}

function mod(x: number, m: number) {
	const r = x % m;
	return r < 0 ? r + m : r;
}
