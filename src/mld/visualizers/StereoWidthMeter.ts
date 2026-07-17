type RingBufferStereoLike = {
	getReadIndex(): number;
	getCapacity(): number;
	getDataView(): Float32Array; // interleaved Float32 audio
};

export class StereoWidthMeter {
	private rafId: number | null = null;

	// smoothed meter value (width ratio)
	private width = 0;
	private peak = 0;
	private peakHoldUntil = 0;

	private readonly canvas: HTMLCanvasElement;
	private readonly rb: RingBufferStereoLike;
	private readonly opts: {
		// interleaving config (defaults to stereo L/R in slots 0/1)
		channels?: number;
		leftChannel?: number;
		rightChannel?: number;

		// analysis window
		windowFrames?: number; // e.g. 1024
		maxFps?: number;

		// smoothing / ballistics
		attackMs?: number; // rise speed
		releaseMs?: number; // fall speed
		peakHoldMs?: number;

		// display range
		maxWidth?: number; // 2.0 is common
	} = {};

	constructor(
		canvas: HTMLCanvasElement,
		rb: RingBufferStereoLike,
		opts: {
			// interleaving config (defaults to stereo L/R in slots 0/1)
			channels?: number;
			leftChannel?: number;
			rightChannel?: number;

			// analysis window
			windowFrames?: number; // e.g. 1024
			maxFps?: number;

			// smoothing / ballistics
			attackMs?: number; // rise speed
			releaseMs?: number; // fall speed
			peakHoldMs?: number;

			// display range
			maxWidth?: number; // 2.0 is common
		} = {}
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

		// HiDPI
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

		// Background
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = '#0b0f17';
		ctx.fillRect(0, 0, w, h);

		const cap = this.rb.getCapacity();
		const data = this.rb.getDataView();
		if (!cap || cap <= 0 || data.length !== cap) {
			this.drawCenteredText(ctx, w, h, 'Invalid buffer');
			return;
		}

		const channels = this.opts.channels ?? 2;
		const lch = this.opts.leftChannel ?? 0;
		const rch = this.opts.rightChannel ?? 1;
		if (
			channels < 2 ||
			lch === rch ||
			lch < 0 ||
			rch < 0 ||
			lch >= channels ||
			rch >= channels
		) {
			this.drawCenteredText(ctx, w, h, 'Invalid channel config');
			return;
		}

		const windowFrames = this.opts.windowFrames ?? 1024;
		const windowSamples = windowFrames * channels;

		// Analyze window ending at read index
		const readIndex = this.rb.getReadIndex();
		const start = readIndex - windowSamples;

		// RMS Mid/Side
		const { rmsM, rmsS } = computeMidSideRms(
			data,
			cap,
			start,
			windowFrames,
			channels,
			lch,
			rch
		);

		// Width ratio
		const eps = 1e-12;
		const targetWidth = rmsS / (rmsM + eps);

		// Clamp to display max for stability
		const maxWidth = this.opts.maxWidth ?? 2.0;
		const targetClamped = clamp(targetWidth, 0, maxWidth);

		// Ballistics
		const maxFps = this.opts.maxFps ?? 60;
		const dt = 1000 / maxFps;

		const attackMs = this.opts.attackMs ?? 40;
		const releaseMs = this.opts.releaseMs ?? 250;

		const aUp = 1 - Math.exp(-dt / attackMs);
		const aDown = 1 - Math.exp(-dt / releaseMs);

		if (targetClamped > this.width)
			this.width = lerp(this.width, targetClamped, aUp);
		else this.width = lerp(this.width, targetClamped, aDown);

		// Peak hold
		const peakHoldMs = this.opts.peakHoldMs ?? 700;
		if (this.width >= this.peak || nowMs >= this.peakHoldUntil) {
			this.peak = this.width;
			this.peakHoldUntil = nowMs + peakHoldMs;
		} else {
			this.peak = Math.max(this.peak - maxWidth / 600, this.width);
		}

		// Draw meter
		this.drawMeter(ctx, w, h, this.width, this.peak, rmsM, rmsS, maxWidth);
	}

	private drawMeter(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		width: number,
		peak: number,
		rmsM: number,
		rmsS: number,
		maxWidth: number
	) {
		const pad = Math.max(10, Math.min(w, h) * 0.06);
		const barW = w - pad * 2;
		const barH = Math.max(14, h * 0.12);

		const x0 = pad;
		const y0 = h * 0.55;

		// Title
		ctx.fillStyle = '#e7edf8';
		ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillText('Stereo Width', x0, pad);

		// Subtext (M/S)
		ctx.fillStyle = '#9fb0cc';
		ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.fillText(`RMS M: ${ampToDb(rmsM).toFixed(1)} dB`, x0, pad + 18);
		ctx.fillText(`RMS S: ${ampToDb(rmsS).toFixed(1)} dB`, x0, pad + 34);

		// Bar background
		roundRect(ctx, x0, y0, barW, barH, 8);
		ctx.fillStyle = '#1a2336';
		ctx.fill();

		// Scale ticks: 0, 0.5, 1, 1.5, 2 (or maxWidth)
		ctx.strokeStyle = '#2a3344';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (const t of makeTicks(maxWidth)) {
			const tx = x0 + (t / maxWidth) * barW;
			ctx.moveTo(tx, y0);
			ctx.lineTo(tx, y0 + barH);
		}
		ctx.stroke();

		// Fill up to current width
		const frac = width / maxWidth;
		const fillW = clamp(frac, 0, 1) * barW;
		roundRect(ctx, x0, y0, fillW, barH, 8);
		ctx.fillStyle = '#4f7cff';
		ctx.fill();

		// Marker at 1.0 (typical “neutral-ish” reference)
		const ref = 1.0;
		if (ref <= maxWidth) {
			const rx = x0 + (ref / maxWidth) * barW;
			ctx.strokeStyle = '#00d4a6';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(rx, y0 - 6);
			ctx.lineTo(rx, y0 + barH + 6);
			ctx.stroke();

			ctx.fillStyle = '#00d4a6';
			ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			ctx.fillText('1.0', rx, y0 - 8);
		}

		// Peak marker
		const px = x0 + (peak / maxWidth) * barW;
		ctx.strokeStyle = '#ff5a7a';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(px, y0 - 2);
		ctx.lineTo(px, y0 + barH + 2);
		ctx.stroke();

		// Needle / current marker
		const nx = x0 + (width / maxWidth) * barW;
		ctx.strokeStyle = '#e7edf8';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(nx, y0 - 10);
		ctx.lineTo(nx, y0 + barH + 10);
		ctx.stroke();

		// Readout
		ctx.fillStyle = '#e7edf8';
		ctx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'right';
		ctx.textBaseline = 'top';
		ctx.fillText(`${width.toFixed(2)}×`, x0 + barW, pad);

		// Labels under bar
		ctx.fillStyle = '#9fb0cc';
		ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillText('mono', x0, y0 + barH + 10);
		ctx.textAlign = 'right';
		ctx.fillText('wide', x0 + barW, y0 + barH + 10);
	}

	private drawCenteredText(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		text: string
	) {
		ctx.fillStyle = '#e7edf8';
		ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2);
	}
}

function computeMidSideRms(
	data: Float32Array,
	cap: number,
	startSample: number,
	frames: number,
	channels: number,
	lch: number,
	rch: number
) {
	let sumM = 0;
	let sumS = 0;
	const invSqrt2 = 1 / Math.sqrt(2);

	for (let f = 0; f < frames; f++) {
		const base = startSample + f * channels;
		const L = data[mod(base + lch, cap)];
		const R = data[mod(base + rch, cap)];

		const M = (L + R) * invSqrt2;
		const S = (L - R) * invSqrt2;

		sumM += M * M;
		sumS += S * S;
	}

	const n = Math.max(1, frames);
	return {
		rmsM: Math.sqrt(sumM / n),
		rmsS: Math.sqrt(sumS / n)
	};
}

function ampToDb(a: number) {
	const eps = 1e-12;
	return 20 * Math.log10(Math.max(eps, a));
}

function makeTicks(maxWidth: number) {
	// Nice default ticks up to maxWidth
	const base = [0, 0.5, 1, 1.5, 2];
	return base.filter(t => t <= maxWidth + 1e-9);
}

function mod(x: number, m: number) {
	const r = x % m;
	return r < 0 ? r + m : r;
}

function clamp(x: number, lo: number, hi: number) {
	return x < lo ? lo : x > hi ? hi : x;
}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
) {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}
