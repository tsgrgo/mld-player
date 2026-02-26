import { SharedRingBuffer } from './SharedRingBuffer';

import ProducerWorker from './workers/mld-producer?worker';
import workletUrl from './workers/mld-consumer?worker&url';

const BUFFER_SIZE = 2 ** 21;

export async function createMldPlayer() {
	const sab = SharedRingBuffer.createBuffer(BUFFER_SIZE);
	const ringBuffer = new SharedRingBuffer(sab, Float32Array);
	const forceCheckMessages = new SharedArrayBuffer(1);

	const ctx = new AudioContext({ sampleRate: 44100 });
	await ctx.resume();

	// Start producer
	const worker = new ProducerWorker();
	worker.postMessage({
		type: 'init',
		sampleRate: ctx.sampleRate,
		forceCheckMessages,
		sab
	});
	worker.onmessage = (e: MessageEvent<unknown>) => {
		console.log(e);
	};

	// Start consumer
	await ctx.audioWorklet.addModule(workletUrl);
	const node = new AudioWorkletNode(ctx, 'mld-consumer', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2]
	});
	node.connect(ctx.destination);
	node.port.postMessage({ type: 'sab', sab });

	return {
		ctx,
		node,
		worker,
		ringBuffer,
		load: (arrayBuffer: ArrayBuffer) => {
			worker.postMessage({ type: 'load', buffer: arrayBuffer });
			setTimeout(() => {
				const arr = new Uint8Array(forceCheckMessages);
				arr[0] = 1;
			}, 10);
		},
		stop: async () => {
			worker.postMessage({ type: 'stop' });
			node.disconnect();
			await ctx.close();
			worker.terminate();
		}
	};
}
