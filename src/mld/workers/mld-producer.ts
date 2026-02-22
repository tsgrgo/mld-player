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
		temp = new Float32Array(1024);
		running = true;
		void pump();
	} else if (msg.type === 'load') {
		if (!buffer) return;
		const bytes = new Uint8Array(msg.buffer);
		const mld = new MLD(bytes);

		const sampler = new MA3Sampler();
		// const sampler = new SineSampler();

		player = new MLDPlayer(mld, sampler, sampleRate);

		sendMldInfo(mld);
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

async function pump() {
	while (running) {
		if (!buffer || !player || !temp) {
			await sleep(10);
			continue;
		}

		const freeSamples = buffer.availableWriteSize();
		// console.log(freeSamples);

		if (freeSamples >= temp.length) {
			const frames = temp.length / 2;
			player.render(temp, 0, frames);

			const written = buffer.write(temp, 0, temp.length);
			if (written < temp.length) await sleep(1);

			continue;
		}

		// Not enough space
		// await sleep(200);
	}
}

function sleep(ms: number) {
	return new Promise<void>(r => setTimeout(r, ms));
}
