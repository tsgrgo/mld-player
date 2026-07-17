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

const title = el('h3', { textContent: 'MLD player - MA3 Sound Chip' });
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

const status = el('p', { textContent: 'Choose or drag & drop an .mld file.' });

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
		createVisualizers(mldPlayer.ringBuffer, mldPlayer.separateChannels);
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

/////////////////////////////////////////

async function handleFiles(files: FileList | File[]) {
	const file = Array.from(files)[0];
	if (!file) return;

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
}

input.addEventListener('change', () => {
	if (input.files) handleFiles(input.files);
	input.value = '';
});

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
	(window.addEventListener(evt, (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
	}),
		{ passive: false });
});

// Optional overlay for UX
const overlay = el('div');
overlay.style.cssText = `
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.35);
  color: white;
  font: 600 18px system-ui, sans-serif;
  z-index: 999999;
  pointer-events: none;
`;
overlay.textContent = 'Drop .mld file to load';
document.body.appendChild(overlay);

let dragDepth = 0;

window.addEventListener('dragenter', e => {
	// Only show overlay if a file is being dragged
	const dt = (e as DragEvent).dataTransfer;
	if (!dt?.types?.includes('Files')) return;

	dragDepth++;
	overlay.style.display = 'flex';
});

window.addEventListener('dragleave', e => {
	const dt = (e as DragEvent).dataTransfer;
	if (dt && !dt.types.includes('Files')) return;

	dragDepth = Math.max(0, dragDepth - 1);
	if (dragDepth === 0) overlay.style.display = 'none';
});

window.addEventListener('drop', e => {
	overlay.style.display = 'none';
	dragDepth = 0;

	const dt = (e as DragEvent).dataTransfer;
	if (!dt?.files?.length) return;

	handleFiles(dt.files);
});
