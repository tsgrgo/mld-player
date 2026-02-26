import { createMldPlayer } from './mld/createMldPlayer';
import { createVisualizers } from './mld/createVisualizers';

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {}
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	Object.assign(e, props);
	return e;
}

const root = document.getElementById('app') ?? document.body;

const title = el('h3', { textContent: 'MLD player' });
const input = el('input');
input.type = 'file';
input.accept = '.mld,application/octet-stream';

const demoButton = el('button', { textContent: 'Load Demo' });

const slideBar = el('input', {
	type: 'range',
	min: '0',
	max: '1',
	step: '0.01',
	value: '0'
});

slideBar.addEventListener('input', event => {
	const val = parseFloat((event.target as HTMLInputElement).value);
	sliderPos = val;
	mldPlayer?.setTime(val);
});

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

let mldPlayer: Awaited<ReturnType<typeof createMldPlayer>>; // Damn this is ugly

async function createPlayerIfNeeded() {
	if (!mldPlayer) {
		mldPlayer = await createMldPlayer();
		createVisualizers(mldPlayer.ringBuffer);
		mldPlayer.events.on('info', e => {
			const info = e.detail;
			status.textContent = 'Parsed OK.';
			pTitle.textContent = `Title: ${info.title || '(none)'}`;
			pVersion.textContent = `Version: ${info.version || '(none)'}`;
			pDate.textContent = `Date: ${info.date || '(none)'}`;
			pCopyright.textContent = `Copyright: ${info.copyright || '(none)'}`;
			pDurationLooping.textContent = `Duration (with looping): ${info.durationLooping}`;
			pDurationNoLoop.textContent = `Duration (without looping): ${info.durationNoLoop}`;
			setSlideBarSpeed(info.durationNoLoop);
		});
	}
}

let sliderBarInterval: number;
let sliderPos = 0;

function setSlideBarSpeed(durationSeconds: number) {
	sliderPos = 0;

	const interval = 100;
	const numOfTick = (durationSeconds * 1000) / interval;
	const increment = 1 / numOfTick;

	clearInterval(sliderBarInterval);
	sliderBarInterval = setInterval(() => {
		sliderPos += increment;
		slideBar.value = `${sliderPos % 1}`;
	}, interval);
}

demoButton.addEventListener('click', async () => {
	status.textContent = 'Reading...';

	const response = await fetch('/demo.mld');

	if (!response.ok) {
		throw new Error(
			`Failed to fetch file: ${response.status} ${response.statusText}`
		);
	}

	const buffer = await response.arrayBuffer();

	await createPlayerIfNeeded();
	mldPlayer.load(buffer);
});

// eslint-disable-next-line @typescript-eslint/no-misused-promises
input.addEventListener('change', async () => {
	clearInfo();

	const file = input.files?.[0];
	if (!file) {
		status.textContent = 'No file selected.';
		return;
	}

	status.textContent = 'Reading...';

	await createPlayerIfNeeded();
	mldPlayer.load(await file.arrayBuffer());

	// 	status.textContent = 'Failed to parse.';
	// 	const msg = err instanceof Error ? err.message : String(err);
	// 	pFile.textContent = `Error: ${msg}`;
	// }
});

root.append(
	title,
	input,
	demoButton,
	slideBar,
	status,
	pFile,
	pTitle,
	pVersion,
	pDate,
	pCopyright,
	pDurationLooping,
	pDurationNoLoop
);
