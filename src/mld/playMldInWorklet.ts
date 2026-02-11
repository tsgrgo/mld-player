import workletUrl from './mld-worklet.ts?worker&url';

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

export async function playMldInWorklet(file: File) {
	const audioContext = new AudioContext();
	await audioContext.audioWorklet.addModule(workletUrl);

	const node = new AudioWorkletNode(audioContext, 'mld-player', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2]
	});

	node.connect(audioContext.destination);

	node.port.onmessage = (e: MessageEvent<WorkletToMainMsg>) => {
		const msg = e.data;
		if (msg.type === 'info') {
			console.log(msg);
		} else if (msg.type === 'error') {
			console.error(msg.message);
		}
	};

	// Send MLD to worklet
	const buffer = await file.arrayBuffer();
	node.port.postMessage({ type: 'load', buffer }, [buffer]);

	await audioContext.resume();

	return { audioCtx: audioContext, node };
}
