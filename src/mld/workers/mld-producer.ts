import { MA3Sampler } from '../core/MA3Sampler';
import { MLD } from '../core/MLD';
import { MLDPlayer } from '../core/MLDPlayer';
import { SineSampler } from '../core/SineSampler';
import { SharedRingBuffer } from '../SharedRingBuffer';

type InitMsg = {
	type: 'init';
	sab: SharedArrayBuffer;
	forceCheckMessages: SharedArrayBuffer;
	sampleRate: number;
};
type LoadMsg = { type: 'load'; buffer: ArrayBuffer };
type StopMsg = { type: 'stop' };
type Msg = InitMsg | LoadMsg | StopMsg;

const RESERVED_SPACE = 2 ** 12;
const RENDER_BATCH_SIZE = 2 ** 10;

let buffer: SharedRingBuffer<Float32Array>;
let player: MLDPlayer;
let sampleRate: number;
let forceCheckMessages: Uint8Array;

let running = false;
let temp: Float32Array;
let renderFrames: number;

self.onmessage = (e: MessageEvent<Msg>) => {
	console.log('msg in producer', e);

	const msg = e.data;
	if (msg.type === 'init') {
		buffer = new SharedRingBuffer(msg.sab, Float32Array);
		forceCheckMessages = new Uint8Array(msg.forceCheckMessages);
		sampleRate = msg.sampleRate;
		temp = new Float32Array(RENDER_BATCH_SIZE);
		renderFrames = temp.length / 2;
		running = true;
		void startRenderLoop();
	} else if (msg.type === 'load') {
		if (!buffer) return;
		const bytes = new Uint8Array(msg.buffer);
		const mld = new MLD(bytes);

		const sampler = new MA3Sampler();
		// const sampler = new SineSampler();

		player = new MLDPlayer(mld, sampler, sampleRate);

		buffer.clear();
		sendMldInfo(mld);
	} else if (msg.type === 'stop') {
		running = false;
	}
};

function sendMldInfo(mld: MLD) {
	self.postMessage({
		type: 'info',
		title: mld.getTitle(),
		version: mld.getVersion(),
		date: mld.getDate(),
		copyright: mld.getCopyright(),
		durationLooping: mld.getDuration(false),
		durationNoLoop: mld.getDuration(true)
	});
}

async function startRenderLoop() {
	while (running) {
		if (!buffer || !player || !temp || !renderFrames) {
			await sleep(10);
			continue;
		}

		if (buffer.availableWriteSize() >= temp.length + RESERVED_SPACE) {
			player.render(temp, 0, renderFrames);
			buffer.write(temp, 0, temp.length);

			if (forceCheckMessages[0] === 1) {
				forceCheckMessages[0] = 0;
				await sleep(10);
			}
			continue;
		}

		// Not enough space
		await sleep(10);
	}
}

function sleep(ms: number) {
	return new Promise<void>(r => setTimeout(r, ms));
}
