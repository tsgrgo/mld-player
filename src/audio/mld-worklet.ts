import { MLD } from '../com/keitaiwiki/music/MLD';
import { MLDPlayer } from '../com/keitaiwiki/music/MLDPlayer';
import { SineSampler } from '../com/keitaiwiki/music/SineSampler';

type LoadMsg = { type: 'load'; buffer: ArrayBuffer; fileName?: string };
type VolumeMsg = { type: 'volume'; value: number };
type Msg = LoadMsg | VolumeMsg;

class MLDPlayerProcessor extends AudioWorkletProcessor {
	private player: MLDPlayer | null = null;
	private volume = 0.5;
	private renderBuffer = new Float32Array(0); // interleaved stereo

	constructor() {
		super();

		this.port.onmessage = (e: MessageEvent<Msg>) => {
			const msg = e.data;

			if (msg.type === 'volume') {
				this.volume = msg.value;
				return;
			}

			if (msg.type === 'load') {
				try {
					const bytes = new Uint8Array(msg.buffer);
					const mld = new MLD(bytes);

					const sampler = new SineSampler();
					this.player = new MLDPlayer(mld, sampler, sampleRate);

					// Send metadata back to main thread so you can update UI
					const result = {
						type: 'info',
						title: mld.getTitle() ?? null,
						version: mld.getVersion() ?? null,
						date: mld.getDate() ?? null,
						copyright: mld.getCopyright() ?? null,
						durationLooping: mld.getDuration(false),
						durationNoLoop: mld.getDuration(true)
					};

					console.log(result);
					this.port.postMessage(result);
				} catch (err) {
					const message =
						err instanceof Error ? err.message : String(err);
					this.player = null;
					this.port.postMessage({ type: 'error', message });
				}
			}
		};
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

		console.log(needed);

		this.player.render(this.renderBuffer, 0, frames);

		if (this.player.isFinished()) return false;

		for (let i = 0; i < frames; i++) {
			left[i] = this.renderBuffer[i * 2] * this.volume;
			if (right !== left)
				right[i] = this.renderBuffer[i * 2 + 1] * this.volume;
		}

		return true; // keep alive
	}
}

registerProcessor('mld-player', MLDPlayerProcessor);
