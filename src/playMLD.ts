import workletUrl from './audio/mld-worklet.ts?worker&url';

type MldInfoMsg = {
	type: 'info';
	title: string | null;
	version: string | null;
	date: string | null;
	copyright: string | null;
	durationLooping: number;
	durationNoLoop: number;
};

type WorkletToMainMsg = MldInfoMsg | { type: 'error'; message: string };

async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
	return await file.arrayBuffer();
}

export async function playFileInWorklet(file: File) {
	const audioCtx = new AudioContext();
	await audioCtx.audioWorklet.addModule(workletUrl);

	const node = new AudioWorkletNode(audioCtx, 'mld-player', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2]
	});

	node.connect(audioCtx.destination);

	node.port.onmessage = (e: MessageEvent<WorkletToMainMsg>) => {
		const msg = e.data;
		if (msg.type === 'info') {
			console.log(msg);

			// Update your UI here
			// pTitle.textContent = `Title: ${msg.title ?? "(none)"}`;
			// ...
		} else if (msg.type === 'error') {
			// status.textContent = "Failed to parse.";
			// pFile.textContent = `Error: ${msg.message}`;
			console.error(msg.message);
		}
	};

	const buffer = await readAsArrayBuffer(file);

	// Transfer the ArrayBuffer (zero-copy). After this, `buffer.byteLength` becomes 0 on the main thread.
	node.port.postMessage({ type: 'load', buffer, fileName: file.name }, [
		buffer
	]);

	await audioCtx.resume();

	return { audioCtx, node };
}
