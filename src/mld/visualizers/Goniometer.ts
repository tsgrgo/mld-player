type RingBufferStereoLike = {
	getReadIndex(): number;
	getCapacity(): number;
	getDataView(): Float32Array; // interleaved float32 audio
};

export class Goniometer {
	private rafId: number | null = null;
	private lastDrawAt = 0;

	private readonly canvas: HTMLCanvasElement;
	private readonly rb: RingBufferStereoLike;
	private readonly opts: {
		channels?: number; // interleaved channel count (>=2)
		leftChannel?: number; // default 0
		rightChannel?: number; // default 1
		windowFrames?: number; // how many frames to plot
		maxFps?: number;

		gain?: number; // visual gain
		rotate45?: boolean; // common goniometer style: rotate by 45° (mid/side-ish look)
		persistence?: number; // 0..1 background fade each frame (higher = longer trails)
		grid?: boolean;
		drawAxes?: boolean;

		// Visual styling
		background?: string;
		gridColor?: string;
		axesColor?: string;
		traceColor?: string;
		textColor?: string;

		// Sampling
		maxPoints?: number; // cap points drawn (decimation)
	};

	constructor(
		canvas: HTMLCanvasElement,
		rb: RingBufferStereoLike,
		opts: {
			channels?: number; // interleaved channel count (>=2)
			leftChannel?: number; // default 0
			rightChannel?: number; // default 1
			windowFrames?: number; // how many frames to plot
			maxFps?: number;

			gain?: number; // visual gain
			rotate45?: boolean; // common goniometer style: rotate by 45° (mid/side-ish look)
			persistence?: number; // 0..1 background fade each frame (higher = longer trails)
			grid?: boolean;
			drawAxes?: boolean;

			// Visual styling
			background?: string;
			gridColor?: string;
			axesColor?: string;
			traceColor?: string;
			textColor?: string;

			// Sampling
			maxPoints?: number; // cap points drawn (decimation)
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
			// if (t - this.lastDrawAt < minDt) return;
			this.lastDrawAt = t;

			this.draw();
		};
		this.rafId = requestAnimationFrame(tick);
	}

	stop() {
		if (this.rafId != null) cancelAnimationFrame(this.rafId);
		this.rafId = null;
	}

	draw() {
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

		const w = cssW,
			h = cssH;
		const cx = w / 2,
			cy = h / 2;

		const bg = this.opts.background ?? '#0b0f17';
		const persistence = clamp01(this.opts.persistence ?? 0.85);

		// Background with persistence (fade)
		if (persistence <= 0) {
			ctx.clearRect(0, 0, w, h);
			ctx.fillStyle = bg;
			ctx.fillRect(0, 0, w, h);
		} else {
			// draw a translucent rect to fade previous trace
			ctx.fillStyle = withAlpha(bg, 1 - persistence);
			ctx.fillRect(0, 0, w, h);
		}

		// Optional grid/axes
		if (this.opts.grid ?? true) this.drawGrid(ctx, w, h);
		if (this.opts.drawAxes ?? true) this.drawAxes(ctx, w, h);

		// Pull recent samples ending at readIndex
		const channels = Math.max(2, this.opts.channels ?? 2);
		const lch = clampInt(this.opts.leftChannel ?? 0, 0, channels - 1);
		const rch = clampInt(this.opts.rightChannel ?? 1, 0, channels - 1);

		const cap = this.rb.getCapacity();
		const data = this.rb.getDataView();
		if (cap <= 0 || data.length < cap) return;

		const r = this.rb.getReadIndex();

		const windowFrames = Math.max(16, this.opts.windowFrames ?? 1024);
		const windowSamples = windowFrames * channels;

		// Decimate so we don’t draw insane amounts of points on big windows
		const maxPoints = Math.max(200, this.opts.maxPoints ?? 2000);
		const stepFrames = Math.max(1, Math.floor(windowFrames / maxPoints));

		const gain = this.opts.gain ?? 1.0;
		const radius = Math.min(w, h) * 0.45; // fits in canvas

		const rotate45 = this.opts.rotate45 ?? false;
		const rot = rotate45 ? Math.PI / 4 : 0;
		const cos = Math.cos(rot);
		const sin = Math.sin(rot);

		ctx.strokeStyle = this.opts.traceColor ?? '#4f7cff';
		ctx.lineWidth = 1;
		ctx.beginPath();

		// Window start in samples:
		// we plot frames from [r - windowSamples, r) stepping by stepFrames
		const startSample = r - windowSamples;

		let first = true;
		for (let f = 0; f < windowFrames; f += stepFrames) {
			const base = startSample + f * channels;

			const L = data[mod(base + lch, cap)];
			const R = data[mod(base + rch, cap)];

			// Clamp & apply gain
			let x = clamp1(L * gain);
			let y = clamp1(R * gain);

			// Optional rotation
			if (rotate45) {
				const xr = x * cos - y * sin;
				const yr = x * sin + y * cos;
				x = xr;
				y = yr;
			}

			// Map [-1..1] to canvas coords (Y inverted)
			const px = cx + x * radius;
			const py = cy - y * radius;

			if (first) {
				ctx.moveTo(px, py);
				first = false;
			} else {
				ctx.lineTo(px, py);
			}
		}

		ctx.stroke();

		// Label
		ctx.fillStyle = this.opts.textColor ?? '#e7edf8';
		ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillText(
			rotate45 ? 'Goniometer (rot 45°)' : 'Lissajous (L vs R)',
			8,
			8
		);
	}

	private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
		const gridColor = this.opts.gridColor ?? '#182033';
		ctx.strokeStyle = gridColor;
		ctx.lineWidth = 1;

		// outer circle guide
		const cx = w / 2,
			cy = h / 2;
		const r = Math.min(w, h) * 0.45;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.stroke();

		// inner circle
		ctx.beginPath();
		ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
		ctx.stroke();

		// diagonals
		ctx.beginPath();
		ctx.moveTo(cx - r, cy - r);
		ctx.lineTo(cx + r, cy + r);
		ctx.moveTo(cx - r, cy + r);
		ctx.lineTo(cx + r, cy - r);
		ctx.stroke();
	}

	private drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number) {
		const axesColor = this.opts.axesColor ?? '#2a3344';
		ctx.strokeStyle = axesColor;
		ctx.lineWidth = 1;

		const cx = w / 2,
			cy = h / 2;
		ctx.beginPath();
		ctx.moveTo(0, cy);
		ctx.lineTo(w, cy);
		ctx.moveTo(cx, 0);
		ctx.lineTo(cx, h);
		ctx.stroke();
	}
}

function clamp01(x: number) {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clamp1(x: number) {
	return x < -1 ? -1 : x > 1 ? 1 : x;
}
function clampInt(x: number, lo: number, hi: number) {
	if (x < lo) return lo;
	if (x > hi) return hi;
	return x | 0;
}
function mod(x: number, m: number) {
	const r = x % m;
	return r < 0 ? r + m : r;
}

// Accepts hex like "#0b0f17" and returns rgba string with alpha
function withAlpha(hex: string, alpha: number) {
	// minimal hex handling: #rgb or #rrggbb
	const h = hex.replace('#', '').trim();
	let r = 0,
		g = 0,
		b = 0;
	if (h.length === 3) {
		r = parseInt(h[0] + h[0], 16);
		g = parseInt(h[1] + h[1], 16);
		b = parseInt(h[2] + h[2], 16);
	} else if (h.length === 6) {
		r = parseInt(h.slice(0, 2), 16);
		g = parseInt(h.slice(2, 4), 16);
		b = parseInt(h.slice(4, 6), 16);
	} else {
		// fallback: if not hex, just return it (won't fade)
		return hex;
	}
	return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}
