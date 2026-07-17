import { MA3Sampler } from '../core/MA3Sampler';
import { MLD } from '../core/MLD';
import { MLDPlayer } from '../core/MLDPlayer';
import { SineSampler } from '../core/SineSampler';
import { SharedRingBuffer } from '../SharedRingBuffer';

const RENDER_BATCH_SIZE = 2 ** 10;

let buffer: SharedRingBuffer<Float32Array>;
let separateBuffer: SharedRingBuffer<Float32Array>;

let player: MLDPlayer;
let sampleRate: number;
let forceCheckMessages: Uint8Array;

let running = false;
let temp: Float32Array;
let tempSeparate: Float32Array;
let renderFrames: number;
let reservedSpace = 0;

self.onmessage = (e: MessageEvent<ProducerMessage>) => {
	const msg = e.data;
	console.log('msg in producer', msg);

	if (msg.type === 'init') {
		initialize(msg);
	} else if (msg.type === 'load') {
		loadMld(msg);
	} else if (msg.type === 'stop') {
		running = false;
	} else if (msg.type === 'setTime') {
		player?.setTime(msg.time * player?.getDuration(true));
		clearBuffers();
	}
};

function initialize(msg: InitMsg) {
	buffer = new SharedRingBuffer(msg.sab, Float32Array);
	separateBuffer = new SharedRingBuffer(msg.sabSeparate, Float32Array);
	forceCheckMessages = new Uint8Array(msg.forceCheckMessages);
	reservedSpace = buffer.getCapacity() * 0.02;
	sampleRate = msg.sampleRate;
	temp = new Float32Array(RENDER_BATCH_SIZE);
	tempSeparate = new Float32Array((RENDER_BATCH_SIZE / 2) * 16);
	renderFrames = temp.length / 2;
}

function loadMld(msg: LoadMsg) {
	if (!buffer) return;

	const bytes = new Uint8Array(msg.buffer);
	const mld = new MLD(bytes);

	const instrumentType = 0;
	const drumType = 0;
	const waveDrumType = 0;

	const sampler = new MA3Sampler(instrumentType, drumType, waveDrumType);
	// const sampler = new SineSampler();

	player = new MLDPlayer(mld, sampler, sampleRate);
	clearBuffers();
	sendMldInfo(mld);

	void startRenderLoop();
}

function clearBuffers() {
	buffer.clear();
	separateBuffer.clear();
}

function sendMldInfo(mld: MLD) {
	self.postMessage({
		type: 'info',
		info: {
			title: mld.getTitle(),
			version: mld.getVersion(),
			date: mld.getDate(),
			copyright: mld.getCopyright(),
			durationLooping: mld.getDuration(false),
			durationNoLoop: mld.getDuration(true)
		}
	} satisfies InfoMsg);
}

async function startRenderLoop() {
	if (running) return;
	running = true;

	if (!buffer || !player || !temp || !renderFrames) {
		throw new Error('player not initialized');
	}

	while (running) {
		if (buffer.availableWriteSize() >= temp.length + reservedSpace) {
			player.render(
				temp,
				0,
				renderFrames,
				1,
				1,
				true,
				true,
				tempSeparate
			);
			buffer.write(temp, 0, temp.length);

			separateBuffer.write(tempSeparate, 0, tempSeparate.length);

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
