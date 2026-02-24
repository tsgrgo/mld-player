type RingBufferLike = {
	getReadIndex(): number;
	getWriteIndex(): number;
	availableReadSize(): number;
	availableWriteSize(): number;
	getCapacity?: () => number;
};

type RingBufferVisualizerOptions = {
	donutWidth?: number;
	maxFps?: number;
	showText?: boolean;
	usedColor?: string;
	freeColor?: string;
	bgColor?: string;
	readMarkerColor?: string;
	writeMarkerColor?: string;
	textColor?: string;
};

export class RingBufferVisualizer {
	private rafId: number | null = null;
	private lastDrawAt = 0;

	private readonly canvas: HTMLCanvasElement;
	private readonly buffer: RingBufferLike;
	private readonly options: RingBufferVisualizerOptions = {};

	constructor(
		canvas: HTMLCanvasElement,
		buffer: RingBufferLike,
		options: RingBufferVisualizerOptions = {}
	) {
		this.canvas = canvas;
		this.buffer = buffer;
		this.options = options;
	}

	start() {
		if (this.rafId != null) return;
		const tick = (t: number) => {
			this.rafId = requestAnimationFrame(tick);

			const maxFps = this.options.maxFps ?? 60;
			const minDt = 1000 / maxFps;
			if (t - this.lastDrawAt < minDt) return;
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
		ctx.clearRect(0, 0, w, h);

		const bg = this.options.bgColor ?? '#0b0f17';
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);

		const capacity = this.getCapacitySafe();
		if (!capacity || capacity <= 0) {
			this.drawCenteredText(ctx, w, h, 'No capacity');
			return;
		}

		// Markers for read/write positions
		const rIdx = this.buffer.getReadIndex();
		const wIdx = this.buffer.getWriteIndex();
		const rPos = mod(rIdx, capacity);
		const wPos = mod(wIdx, capacity);

		const readMarkerColor = this.options.readMarkerColor ?? '#00d4a6';
		const writeMarkerColor = this.options.writeMarkerColor ?? '#ff5a7a';

		const used = clampInt(this.buffer.availableReadSize(), 0, capacity);
		const free = clampInt(this.buffer.availableWriteSize(), 0, capacity);

		const usedFrac = clamp01(used / capacity);
		const freeFrac = clamp01(free / capacity);

		const cx = w / 2;
		const cy = h / 2;
		const radius = Math.min(w, h) * 0.3;
		const donutWidth =
			this.options.donutWidth ?? Math.max(12, radius * 0.25);

		const usedColor = this.options.usedColor ?? '#4f7cff';
		const freeColor = this.options.freeColor ?? '#2a3344';

		const startAngle = -Math.PI / 2; // top

		// Draw free full ring first
		this.drawArc(
			ctx,
			cx,
			cy,
			radius,
			2,
			startAngle,
			startAngle + Math.PI * 2,
			freeColor
		);

		// Draw used wedge on top
		this.drawArc(
			ctx,
			cx,
			cy,
			radius,
			donutWidth,
			startAngle + (rPos / capacity) * Math.PI * 2,
			startAngle +
				(rPos / capacity) * Math.PI * 2 +
				usedFrac * Math.PI * 2,
			usedColor
		);

		// this.drawMarker(
		// 	ctx,
		// 	cx,
		// 	cy,
		// 	radius,
		// 	startAngle,
		// 	rPos / capacity,
		// 	readMarkerColor,
		// 	'R'
		// );
		// this.drawMarker(
		// 	ctx,
		// 	cx,
		// 	cy,
		// 	radius,
		// 	startAngle,
		// 	wPos / capacity,
		// 	writeMarkerColor,
		// 	'W'
		// );

		if (this.options.showText ?? true) {
			const textColor = this.options.textColor ?? '#e7edf8';
			ctx.fillStyle = textColor;
			ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
			ctx.textAlign = 'center';

			const pct = Math.round(usedFrac * 100);
			ctx.fillText(`Used: ${used} / ${capacity} (${pct}%)`, cx, cy + 6);
			ctx.fillText(`Free: ${free}`, cx, cy + 24);
		} else {
			const textColor = this.options.textColor ?? '#e7edf8';
			ctx.fillStyle = textColor;
			ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
			ctx.textAlign = 'center';

			ctx.fillText(`Buffer`, cx, cy + 6);
		}
	}

	private getCapacitySafe(): number {
		if (this.buffer.getCapacity) return this.buffer.getCapacity();
		return 0;
	}

	private drawArc(
		ctx: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		radius: number,
		width: number,
		a0: number,
		a1: number,
		color: string
	) {
		ctx.beginPath();
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.lineCap = 'butt';
		ctx.arc(cx, cy, radius, a0, a1, false);
		ctx.stroke();
	}

	private drawMarker(
		ctx: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		radius: number,
		startAngle: number,
		frac: number,
		color: string,
		label: string
	) {
		const angle = startAngle + frac * Math.PI * 2;
		const rOuter = radius + 10;
		const rInner = radius - 10;

		const x0 = cx + Math.cos(angle) * rInner;
		const y0 = cy + Math.sin(angle) * rInner;
		const x1 = cx + Math.cos(angle) * rOuter;
		const y1 = cy + Math.sin(angle) * rOuter;

		ctx.beginPath();
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.moveTo(x0, y0);
		ctx.lineTo(x1, y1);
		ctx.stroke();

		// small label slightly outside
		const lx = cx + Math.cos(angle) * (rOuter + 12);
		const ly = cy + Math.sin(angle) * (rOuter + 12);

		ctx.fillStyle = color;
		ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, lx, ly);
	}

	private drawCenteredText(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		text: string
	) {
		ctx.fillStyle = this.options.textColor ?? '#e7edf8';
		ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, w / 2, h / 2);
	}
}

function clamp01(x: number) {
	return x < 0 ? 0 : x > 1 ? 1 : x;
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
