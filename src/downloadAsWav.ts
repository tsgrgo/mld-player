export function downloadAsWav(data: number[] | Float32Array) {
	const sampleRate = 44100;
	const channels = 2;
	const bytesPerSample = 2; // 16-bit PCM

	const samples =
		data instanceof Float32Array ? data : new Float32Array(data);

	if (samples.length % channels !== 0) {
		throw new Error('PCM data length is not divisible by channel count');
	}

	const frameCount = samples.length / channels;
	const blockAlign = channels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = frameCount * blockAlign;

	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	const writeString = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) {
			view.setUint8(offset + i, str.charCodeAt(i));
		}
	};

	// RIFF header
	writeString(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeString(8, 'WAVE');

	// fmt chunk
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM
	view.setUint16(20, 1, true); // format = PCM
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, 16, true); // bits per sample

	// data chunk
	writeString(36, 'data');
	view.setUint32(40, dataSize, true);

	// Write PCM samples
	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		let s = samples[i];
		if (s > 1) s = 1;
		else if (s < -1) s = -1;

		const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
		view.setInt16(offset, int16, true);
		offset += 2;
	}

	const blob = new Blob([buffer], { type: 'audio/wav' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = 'audio.wav';
	a.click();

	URL.revokeObjectURL(url);
}
