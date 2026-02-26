import { SharedRingBuffer } from '../SharedRingBuffer';

type SabMsg = { type: 'sab'; sab: SharedArrayBuffer };
type Msg = SabMsg;

class MldConsumerProcessor extends AudioWorkletProcessor {
	private buffer?: SharedRingBuffer<Float32Array>;
	private tempBuffer?: Float32Array;

	constructor() {
		super();
		this.port.onmessage = this.handleMessage.bind(this);
	}

	handleMessage(e: MessageEvent<Msg>) {
		const msg = e.data;

		if (msg.type === 'sab') {
			this.buffer = new SharedRingBuffer(msg.sab, Float32Array);
		}
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0];
		const left = output[0];
		const right = output[1] ?? output[0]; // If host provides mono for some reason
		const frames = left.length;

		if (!this.buffer) {
			left.fill(0);
			if (right !== left) right.fill(0);
			return true;
		}

		if (!this.tempBuffer || this.tempBuffer.length !== frames * 2) {
			this.tempBuffer = new Float32Array(frames * 2);
		}

		this.buffer.read(this.tempBuffer);

		let writeIndex = 0;
		for (let i = 0; i < this.tempBuffer.length; i += 2) {
			left[writeIndex] = this.tempBuffer[i];
			right[writeIndex] = this.tempBuffer[i + 1];
			writeIndex++;
		}

		return true;
	}
}

registerProcessor('mld-consumer', MldConsumerProcessor);
