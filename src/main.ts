import { MLD } from './com/keitaiwiki/music/MLD';
import { MLDPlayer } from './com/keitaiwiki/music/MLDPlayer';
import { SineSampler } from './com/keitaiwiki/music/SineSampler';
import { downloadAsWav } from './downloadAsWav';

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {}
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	Object.assign(e, props);
	return e;
}

const root = document.getElementById('app') ?? document.body;

const title = el('h3', { textContent: 'MLD quick viewer' });
const input = el('input');
input.type = 'file';
input.accept = '.mld,application/octet-stream';

const status = el('p', { textContent: 'Choose an .mld file.' });

const pFile = el('p');
const pTitle = el('p');
const pVersion = el('p');
const pDate = el('p');
const pCopyright = el('p');
const pDurationLooping = el('p');
const pDurationNoLoop = el('p');

function clearInfo() {
	pFile.textContent = '';
	pTitle.textContent = '';
	pVersion.textContent = '';
	pDate.textContent = '';
	pCopyright.textContent = '';
	pDurationLooping.textContent = '';
	pDurationNoLoop.textContent = '';
}

async function readAsUint8Array(file: File): Promise<Uint8Array> {
	const buf = await file.arrayBuffer();
	return new Uint8Array(buf);
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
input.addEventListener('change', async () => {
	clearInfo();

	const file = input.files?.[0];
	if (!file) {
		status.textContent = 'No file selected.';
		return;
	}

	status.textContent = 'Reading...';

	try {
		const bytes = await readAsUint8Array(file);

		// If your API is different, change this line accordingly.
		// e.g. const mld = MLD.parse(bytes);
		const mld = new MLD(bytes);

		status.textContent = 'Parsed OK.';

		pFile.textContent = `File: ${file.name} (${bytes.length} bytes)`;
		pTitle.textContent = `Title: ${mld.getTitle() || '(none)'}`;
		pVersion.textContent = `Version: ${mld.getVersion() || '(none)'}`;
		pDate.textContent = `Date: ${mld.getDate() || '(none)'}`;
		pCopyright.textContent = `Copyright: ${mld.getCopyright() || '(none)'}`;
		pDurationLooping.textContent = `Duration (with looping): ${mld.getDuration(
			false
		)}`;
		pDurationNoLoop.textContent = `Duration (without looping): ${mld.getDuration(
			true
		)}`;

		// const sampler = new SineSampler();
		// const player = new MLDPlayer(mld, sampler, 44100);

		playMLD(mld);

		// const samples = new Array<number>(1000000);
		// player.render(samples, 0, 500000);
		// // downloadAsWav(samples);
		// playPCM(samples, 44100);
		// // void playTestAudio(samples);
	} catch (err) {
		status.textContent = 'Failed to parse.';
		const msg = err instanceof Error ? err.message : String(err);
		pFile.textContent = `Error: ${msg}`;
	}
});

root.append(
	title,
	input,
	status,
	pFile,
	pTitle,
	pVersion,
	pDate,
	pCopyright,
	pDurationLooping,
	pDurationNoLoop
);

function playPCM(pcmData: number[], sampleRate: number, channels = 2) {
	const audioContext = new AudioContext();

	const float32 = new Float32Array(pcmData);

	const frameCount = float32.length / channels;
	const audioBuffer = audioContext.createBuffer(
		channels,
		frameCount,
		sampleRate
	);

	for (let ch = 0; ch < channels; ch++) {
		const channelData = audioBuffer.getChannelData(ch);
		for (let i = 0; i < frameCount; i++) {
			channelData[i] = float32[i * channels + ch];
		}
	}

	const source = audioContext.createBufferSource();
	source.buffer = audioBuffer;
	source.connect(audioContext.destination);
	source.start();
}

function playMLD(mld: MLD) {
	const sampler = new SineSampler();
	const player = new MLDPlayer(mld, sampler, 44100);

	const audioCtx = new AudioContext();

	const gainNode = audioCtx.createGain();
	gainNode.gain.value = 0.5; // master volume

	const processorNode = audioCtx.createScriptProcessor(4096, 0, 2);
	processorNode.onaudioprocess = function (e) {
		const bufferLength = e.outputBuffer.length;

		const renderBuffer = new Float32Array(bufferLength * 2);
		player.render(renderBuffer, 0, bufferLength);

		for (let ch = 0; ch < 2; ch++) {
			const channelData = e.outputBuffer.getChannelData(ch);
			for (let i = 0; i < bufferLength; i++) {
				channelData[i] = renderBuffer[i * 2 + ch];
			}
		}
	};

	processorNode.connect(gainNode);
	gainNode.connect(audioCtx.destination);
}
