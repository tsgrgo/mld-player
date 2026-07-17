type RingBufferAudioLike = {
	getReadIndex(): number;
	getCapacity(): number;
	getDataView(): Float32Array; // interleaved float32 audio
};

type SharedRingBufferWaveformOpts = {
	channels?: number; // interleaved channel count
	channel?: number | 'mix'; // which channel, or mix
	windowFrames?: number; // how many frames to show
	maxFps?: number;

	// display options
	gain?: number; // visual gain multiplier
	centerLine?: boolean;
	grid?: boolean;

	// stabilization
	trigger?: boolean; // try to start at a rising zero-crossing
	triggerLookbackFrames?: number; // how far back we search for trigger
};

export class SharedRingBufferWaveform {
	private rafId: number | null = null;
	private scratch: Float32Array = new Float32Array(0);

	private readonly canvas: HTMLCanvasElement;
	private readonly rb: RingBufferAudioLike;
	private readonly opts: SharedRingBufferWaveformOpts = {};

	constructor(
		canvas: HTMLCanvasElement,
		rb: RingBufferAudioLike,
		opts: SharedRingBufferWaveformOpts = {}
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

		// HiDPI crispness
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

		// background
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = '#0b0f17';
		ctx.fillRect(0, 0, w, h);

		const channels = this.opts.channels ?? 2;
		const which = this.opts.channel ?? 0;

		const cap = this.rb.getCapacity();
		const data = this.rb.getDataView();
		const r = this.rb.getReadIndex();

		const windowFrames = this.opts.windowFrames ?? 1024;
		const windowSamples = windowFrames * channels;

		if (cap <= 0 || data.length !== cap) {
			this.drawCenteredText(ctx, w, h, 'Invalid buffer');
			return;
		}
		if (windowSamples <= 0) return;

		// scratch holds the *mono display signal* (one sample per frame)
		if (this.scratch.length < windowFrames) {
			this.scratch = new Float32Array(windowFrames);
		}

		// We build a mono-ish series from the interleaved ring
		// taking frames ending at readIndex.
		// We may shift start to a trigger point for stability.
		const startSample = r - windowSamples;

		// Optional trigger: search a rising zero-crossing near the end of the window.
		let triggerStartSample = startSample;
		if (this.opts.trigger ?? true) {
			const lookbackFrames =
				this.opts.triggerLookbackFrames ?? Math.min(256, windowFrames);
			const lookbackSamples = lookbackFrames * channels;
			const searchEnd = r; // exclusive
			const searchStart = r - lookbackSamples;

			const found = this.findRisingZeroCrossing(
				data,
				cap,
				searchStart,
				searchEnd,
				channels,
				which
			);
			if (found != null) {
				// Keep the same window size but start at trigger
				triggerStartSample = found;
			}
		}

		this.extractDisplaySignal(
			this.scratch,
			data,
			cap,
			triggerStartSample,
			windowFrames,
			channels,
			which
		);

		// Draw grid/centerline
		if (this.opts.grid ?? true) this.drawGrid(ctx, w, h);
		if (this.opts.centerLine ?? true) {
			ctx.strokeStyle = '#2a3344';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, h / 2);
			ctx.lineTo(w, h / 2);
			ctx.stroke();
		}

		// Waveform
		const gain = this.opts.gain ?? 1.0;
		const midY = h / 2;
		const scaleY = h * 0.45 * gain; // keep some headroom

		ctx.strokeStyle = '#4f7cff';
		ctx.lineWidth = 1;
		ctx.beginPath();

		// Map samples -> pixels. If more samples than pixels, we min/max per pixel.
		if (windowFrames <= w) {
			// Simple 1:1-ish
			for (let i = 0; i < windowFrames; i++) {
				const x = (i / (windowFrames - 1)) * (w - 1);
				const y = midY - clamp1(this.scratch[i]) * scaleY;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
		} else {
			// Downsample by envelope to avoid aliasing: min/max per pixel column
			const framesPerPixel = windowFrames / w;
			for (let px = 0; px < w; px++) {
				const a = Math.floor(px * framesPerPixel);
				const b = Math.floor((px + 1) * framesPerPixel);
				let min = 1,
					max = -1;
				for (let i = a; i < b && i < windowFrames; i++) {
					const v = clamp1(this.scratch[i]);
					if (v < min) min = v;
					if (v > max) max = v;
				}
				const x = px;
				// draw a vertical segment for that pixel column (classic oscilloscope envelope)
				const y1 = midY - max * scaleY;
				const y2 = midY - min * scaleY;
				// ctx.moveTo(x, y1);
				ctx.lineTo(x, y2);
			}
		}

		ctx.stroke();

		// Small label
		ctx.fillStyle = '#e7edf8';
		ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillText(
			which === 'mix' ? 'Waveform (mix)' : `Waveform (ch ${which})`,
			8,
			8
		);
	}

	private extractDisplaySignal(
		outFrames: Float32Array,
		data: Float32Array,
		cap: number,
		startSample: number,
		frames: number,
		channels: number,
		which: number | 'mix'
	) {
		if (which === 'mix') {
			// average channels per frame
			for (let f = 0; f < frames; f++) {
				const base = startSample + f * channels;
				let sum = 0;
				for (let ch = 0; ch < channels; ch++) {
					sum += data[mod(base + ch, cap)];
				}
				outFrames[f] = sum / channels;
			}
		} else {
			const ch = which | 0;
			if (ch < 0 || ch >= channels) {
				outFrames.fill(0, 0, frames);
				return;
			}
			for (let f = 0; f < frames; f++) {
				const s = startSample + f * channels + ch;
				outFrames[f] = data[mod(s, cap)];
			}
		}
	}

	private findRisingZeroCrossing(
		data: Float32Array,
		cap: number,
		searchStartSample: number,
		searchEndSample: number,
		channels: number,
		which: number | 'mix'
	): number | null {
		// We scan frame-by-frame (one value per frame) looking for negative->positive.
		// Return the *sample index* (start of frame) where crossing occurs.
		const startFrame = Math.floor(searchStartSample / channels);
		const endFrame = Math.floor(searchEndSample / channels);

		let prev = this.getFrameValue(data, cap, startFrame, channels, which);

		for (let fr = startFrame + 1; fr < endFrame; fr++) {
			const cur = this.getFrameValue(data, cap, fr, channels, which);
			if (prev < 0 && cur >= 0) {
				return fr * channels;
			}
			prev = cur;
		}
		return null;
	}

	private getFrameValue(
		data: Float32Array,
		cap: number,
		frameIndex: number,
		channels: number,
		which: number | 'mix'
	) {
		const base = frameIndex * channels;
		if (which === 'mix') {
			let sum = 0;
			for (let ch = 0; ch < channels; ch++)
				sum += data[mod(base + ch, cap)];
			return sum / channels;
		} else {
			const ch = which | 0;
			return data[mod(base + ch, cap)];
		}
	}

	private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
		ctx.strokeStyle = '#182033';
		ctx.lineWidth = 1;

		// vertical thirds
		for (let i = 1; i <= 2; i++) {
			const x = (w * i) / 3;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, h);
			ctx.stroke();
		}

		// horizontal quarters
		for (let i = 1; i <= 3; i++) {
			const y = (h * i) / 4;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
			ctx.stroke();
		}
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

function clamp1(x: number) {
	return x < -1 ? -1 : x > 1 ? 1 : x;
}
function mod(x: number, m: number) {
	const r = x % m;
	return r < 0 ? r + m : r;
}
