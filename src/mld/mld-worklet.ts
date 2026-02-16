import { MA3Sampler } from './core/MA3Sampler';
import { MLD } from './core/MLD';
import { MLDPlayer } from './core/MLDPlayer';
import { SineSampler } from './core/SineSampler';

type LoadMsg = { type: 'load'; buffer: ArrayBuffer };
type VolumeMsg = { type: 'volume'; value: number };
type Msg = LoadMsg | VolumeMsg;

class MLDPlayerProcessor extends AudioWorkletProcessor {
	private player: MLDPlayer | null = null;
	private renderBuffer = new Float32Array(0);

	constructor() {
		super();

		this.port.onmessage = (e: MessageEvent<Msg>) => {
			const msg = e.data;
			switch (msg.type) {
				case 'load':
					this.loadMld(msg);
					break;

				default:
					break;
			}
		};
	}

	private loadMld(msg: LoadMsg) {
		try {
			const bytes = new Uint8Array(msg.buffer);
			const mld = new MLD(bytes);
			// const sampler = new SineSampler();
			const sampler = new MA3Sampler();
			this.player = new MLDPlayer(mld, sampler, sampleRate);
			this.sendMldInfo(mld);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.player = null;
			this.port.postMessage({ type: 'error', message });
		}
	}

	private sendMldInfo(mld: MLD) {
		const mldInfo = {
			type: 'info',
			title: mld.getTitle(),
			version: mld.getVersion(),
			date: mld.getDate(),
			copyright: mld.getCopyright(),
			durationLooping: mld.getDuration(false),
			durationNoLoop: mld.getDuration(true)
		};
		this.port.postMessage(mldInfo);
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0];
		const left = output[0];
		const right = output[1] ?? output[0]; // if host provides mono for some reason
		const frames = left.length;

		// If not initialized yet, output silence.
		if (!this.player) {
			left.fill(0);
			if (right !== left) right.fill(0);
			return true;
		}

		// Ensure interleaved buffer size: frames * 2
		const needed = frames * 2;
		if (this.renderBuffer.length !== needed) {
			this.renderBuffer = new Float32Array(needed);
		}

		this.player.render(this.renderBuffer, 0, frames);

		// if (this.player.isFinished()) return false;

		for (let i = 0; i < frames; i++) {
			left[i] = this.renderBuffer[i * 2];
			if (right !== left) right[i] = this.renderBuffer[i * 2 + 1];
		}

		return true; // keep alive
	}
}

registerProcessor('mld-player', MLDPlayerProcessor);
