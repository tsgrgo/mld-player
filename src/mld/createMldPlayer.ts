import { SharedRingBuffer } from './SharedRingBuffer';

import ProducerWorker from './workers/mld-producer?worker';
import workletUrl from './workers/mld-consumer?worker&url';
import type { MldInfo } from './types/MldInfo';

const BUFFER_SIZE = 2 ** 20;

type EventMap = {
	info: MldInfo;
};

export async function createMldPlayer() {
	const sab = SharedRingBuffer.createBuffer(BUFFER_SIZE);
	const ringBuffer = new SharedRingBuffer(sab, Float32Array);

	const sabSeparate = SharedRingBuffer.createBuffer((BUFFER_SIZE / 2) * 16);
	const separateChannels = new SharedRingBuffer(sabSeparate, Float32Array);

	const ctx = new AudioContext({ sampleRate: 44100 });
	await ctx.resume();

	// Start producer
	const { sendProducerMessage, events } = createProducer(
		sab,
		sabSeparate,
		ctx.sampleRate
	);

	// Start consumer
	const node = await createConsumer(sab, sabSeparate, ctx);

	console.log('player created');

	return {
		ctx,
		node,
		events,
		ringBuffer,
		separateChannels,
		load: (arrayBuffer: ArrayBuffer) => {
			sendProducerMessage({ type: 'load', buffer: arrayBuffer });
		},
		stop: async () => {
			// worker.postMessage({ type: 'stop' });
			// node.disconnect();
			// await ctx.close();
			// worker.terminate();
		},
		setTime: (time: number) => {
			sendProducerMessage({ type: 'setTime', time });
		}
	};
}

function createProducer(
	sab: SharedArrayBuffer,
	sabSeparate: SharedArrayBuffer,
	sampleRate: number
) {
	const forceCheckMessages = new SharedArrayBuffer(1);
	const forceCheckMessagesView = new Uint8Array(forceCheckMessages);

	const worker = new ProducerWorker();

	const events = createEvents<EventMap>();

	worker.postMessage({
		type: 'init',
		sampleRate: sampleRate,
		forceCheckMessages,
		sabSeparate,
		sab
	} satisfies ProducerMessage);

	worker.onmessage = (e: MessageEvent<ProducerResponse>) => {
		const msg = e.data;

		if (msg.type === 'info') {
			events.emit('info', msg.info);
		}
	};

	const sendProducerMessage = (msg: ProducerMessage) => {
		worker.postMessage(msg);
		setTimeout(() => {
			forceCheckMessagesView[0] = 1;
		}, 10);
	};

	return { sendProducerMessage, events };
}

async function createConsumer(
	sab: SharedArrayBuffer,
	sabSeparate: SharedArrayBuffer,
	ctx: AudioContext
) {
	await ctx.audioWorklet.addModule(workletUrl);
	const node = new AudioWorkletNode(ctx, 'mld-consumer', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2]
	});
	node.connect(ctx.destination);
	node.port.postMessage({
		type: 'sab',
		sab,
		sabSeparate
	} satisfies ConsumerMessage);

	return node;
}

export function createEvents<Events extends Record<string, any>>() {
	const target = new EventTarget();

	return {
		on<K extends keyof Events>(
			type: K,
			listener: (event: CustomEvent<Events[K]>) => void,
			options?: AddEventListenerOptions
		) {
			target.addEventListener(
				type as string,
				listener as EventListener,
				options
			);
			return () =>
				target.removeEventListener(
					type as string,
					listener as EventListener,
					options
				);
		},

		emit<K extends keyof Events>(type: K, detail: Events[K]) {
			target.dispatchEvent(new CustomEvent(type as string, { detail }));
		},

		target
	};
}
