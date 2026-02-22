import { SharedRingBuffer } from './SharedRingBuffer';

import ProducerWorker from './workers/mld-producer?worker';
import workletUrl from './workers/mld-consumer?worker&url';

export async function createMldPlayer() {
	const sharedBuffer = SharedRingBuffer.createBuffer(2 ** 20);
	const ringBuffer = new SharedRingBuffer(sharedBuffer, Float32Array);

	const ctx = new AudioContext({ sampleRate: 44100 });
	await ctx.resume();

	// Start producer
	const worker = new ProducerWorker();
	worker.postMessage({
		type: 'init',
		sab: sharedBuffer,
		sampleRate: ctx.sampleRate
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
	node.port.postMessage({ type: 'sab', sab: sharedBuffer });

	return {
		ctx,
		node,
		worker,
		ringBuffer,
		load: (arrayBuffer: ArrayBuffer) => {
			worker.postMessage({ type: 'load', buffer: arrayBuffer }, [
				arrayBuffer
			]);
		},
		stop: async () => {
			worker.postMessage({ type: 'stop' });
			node.disconnect();
			await ctx.close();
			worker.terminate();
		}
	};
}
