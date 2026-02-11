import { MLD } from '../com/keitaiwiki/music/MLD';
import { MLDPlayer } from '../com/keitaiwiki/music/MLDPlayer';
import { SineSampler } from '../com/keitaiwiki/music/SineSampler';

type InitMsg = { type: 'init'; mld: MLD };
type VolumeMsg = { type: 'volume'; value: number };
type Msg = InitMsg | VolumeMsg;

class MLDPlayerProcessor extends AudioWorkletProcessor {
	private player: MLDPlayer | null = null;
	private volume = 0.5;
	private renderBuffer = new Float32Array(0); // interleaved stereo

	constructor() {
		super();
		this.port.onmessage = (event: MessageEvent<Msg>) => {
			const msg = event.data;
			if (msg.type === 'init') {
				const sampler = new SineSampler();
				// sampleRate is a global in AudioWorkletGlobalScope
				this.player = new MLDPlayer(msg.mld, sampler, sampleRate);
			} else if (msg.type === 'volume') {
				this.volume = msg.value;
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

		this.player.render(this.renderBuffer, 0, frames);

		for (let i = 0; i < frames; i++) {
			left[i] = this.renderBuffer[i * 2] * this.volume;
			if (right !== left)
				right[i] = this.renderBuffer[i * 2 + 1] * this.volume;
		}

		return true; // keep alive
	}
}

registerProcessor('mld-player', MLDPlayerProcessor);
