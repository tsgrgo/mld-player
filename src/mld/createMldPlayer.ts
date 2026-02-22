import ProducerWorker from './mld-producer?worker';
import workletUrl from './mld-consumer?worker&url';
import { SharedRingBuffer } from './SharedRingBuffer';

export async function createMldPlayer(channels = 2, capacityFrames = 1638400) {
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

	// Start consumer
	await ctx.audioWorklet.addModule(workletUrl);
	const node = new AudioWorkletNode(ctx, 'mld-consumer', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [channels]
	});
	node.connect(ctx.destination);
	node.port.postMessage({ type: 'sab', sab: sharedBuffer, channels });

	return {
		ctx,
		node,
		worker,
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
