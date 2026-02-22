import { SharedRingBuffer } from './SharedRingBuffer';

type SabMsg = { type: 'sab'; sab: SharedArrayBuffer };
type Msg = SabMsg;

class MldConsumerProcessor extends AudioWorkletProcessor {
	private buffer?: SharedRingBuffer<Float32Array>;

	constructor() {
		super();

		this.port.onmessage = (e: MessageEvent<Msg>) => {
			console.log('msg in consumer', e);

			const msg = e.data;
			if (msg?.type === 'sab') {
				this.buffer = new SharedRingBuffer(msg.sab, Float32Array);
			}
		};
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0];
		const left = output[0];
		const right = output[1] ?? output[0]; // if host provides mono for some reason
		const frames = left.length;

		if (!this.buffer) {
			left.fill(0);
			if (right !== left) right.fill(0);
			return true;
		}

		const temp = new Float32Array(frames * 2);

		this.buffer.read(temp);

		let index = 0;

		for (let i = 0; i < temp.length; i += 2) {
			left[index] = temp[i];
			right[index] = temp[i + 1];
			index++;
		}

		return true;
	}
}

registerProcessor('mld-consumer', MldConsumerProcessor);
