import { MA3Sampler } from '../core/MA3Sampler';
import { MLD } from '../core/MLD';
import { MLDPlayer } from '../core/MLDPlayer';
import { SineSampler } from '../core/SineSampler';
import { SharedRingBuffer } from '../SharedRingBuffer';

type InitMsg = { type: 'init'; sab: SharedArrayBuffer; sampleRate: number };
type LoadMsg = { type: 'load'; buffer: ArrayBuffer };
type StopMsg = { type: 'stop' };
type Msg = InitMsg | LoadMsg | StopMsg;

let buffer: SharedRingBuffer<Float32Array> | null = null;
let player: MLDPlayer | null = null;
let sampleRate: number;

let running = false;
let temp: Float32Array | null = null;

self.onmessage = (e: MessageEvent<Msg>) => {
	console.log('msg in producer', e);

	const msg = e.data;
	if (msg.type === 'init') {
		buffer = new SharedRingBuffer(msg.sab, Float32Array);
		sampleRate = msg.sampleRate;
		temp = new Float32Array(2 ** 10);
		running = true;
	} else if (msg.type === 'load') {
		if (!buffer) return;
		const bytes = new Uint8Array(msg.buffer);
		const mld = new MLD(bytes);

		const sampler = new MA3Sampler();
		// const sampler = new SineSampler();

		player = new MLDPlayer(mld, sampler, sampleRate);

		buffer.clear();
		sendMldInfo(mld);
		void renderLoop();
	} else if (msg.type === 'stop') {
		running = false;
		player = null;
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

const reservedSpace = 2 ** 12;

async function renderLoop() {
	if (!buffer || !player || !temp) {
		throw new Error('Not initialized');
	}

	while (running) {
		player.render(temp, 0, temp.length / 2);
		buffer.writeAllBlocking(temp, 0, temp.length, reservedSpace);
		await new Promise(r => setTimeout(r, 0));
	}
}
