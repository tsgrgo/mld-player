import { SharedRingBuffer } from '../SharedRingBuffer';

class MldConsumerProcessor extends AudioWorkletProcessor {
	private buffer?: SharedRingBuffer<Float32Array>;
	private tempBuffer?: Float32Array;

	private bufferSeparate?: SharedRingBuffer<Float32Array>;
	private tempBufferSeparate?: Float32Array;

	constructor() {
		super();
		this.port.onmessage = this.handleMessage.bind(this);
	}

	handleMessage(e: MessageEvent<ConsumerMessage>) {
		const msg = e.data;

		if (msg.type === 'sab') {
			this.buffer = new SharedRingBuffer(msg.sab, Float32Array);
			this.bufferSeparate = new SharedRingBuffer(
				msg.sabSeparate,
				Float32Array
			);
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

		if (
			!this.tempBufferSeparate ||
			this.tempBufferSeparate.length !== frames * 16
		) {
			this.tempBufferSeparate = new Float32Array(frames * 16);
		}

		this.buffer.read(this.tempBuffer);
		this.bufferSeparate!.read(this.tempBufferSeparate);

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
