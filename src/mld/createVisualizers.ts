import type { SharedRingBuffer } from './SharedRingBuffer';

import { RingBufferAnalogVU } from './visualizers/RingBufferAnalogVU';
import { RingBufferVisualizer } from './visualizers/RingBufferVisualizer';
import { SharedRingBufferWaveform } from './visualizers/visualizer3';
import { SharedRingBufferGoniometer } from './visualizers/visualizer4';
import { SharedRingBufferStereoWidthMeter } from './visualizers/visualizer5';

export function createVisualizers(
	buffer: SharedRingBuffer<Float32Array>,
	bufferSeparate: SharedRingBuffer<Float32Array>
) {
	const canvas = document.querySelector<HTMLCanvasElement>('#rb')!;
	const bufferVisualizer = new RingBufferVisualizer(canvas, buffer, {
		donutWidth: 3,
		showText: false,
		maxFps: 200
	});

	bufferVisualizer.start();

	const bufferVisualizer2 = new RingBufferVisualizer(
		document.querySelector<HTMLCanvasElement>('#rb2')!,
		bufferSeparate,
		{
			donutWidth: 3,
			showText: false,
			maxFps: 200
		}
	);

	bufferVisualizer2.start();

	const vu1Canvas = document.querySelector<HTMLCanvasElement>('#vu1')!;
	const vu1 = new RingBufferAnalogVU(vu1Canvas, buffer, {
		channels: 2,
		channel: 0,
		windowFrames: 256,
		attackMs: 20,
		releaseMs: 100,
		floorDb: -60,
		ceilingDb: 0,
		maxFps: 120
	});

	vu1.start();

	const vu2Canvas = document.querySelector<HTMLCanvasElement>('#vu2')!;
	const vu2 = new RingBufferAnalogVU(vu2Canvas, buffer, {
		channels: 2,
		channel: 1,
		windowFrames: 256,
		attackMs: 20,
		releaseMs: 100,
		floorDb: -60,
		ceilingDb: 0,
		maxFps: 120
	});

	vu2.start();

	const canvasGoniometer =
		document.querySelector<HTMLCanvasElement>('#goniometer')!;
	const goniometer = new SharedRingBufferGoniometer(
		canvasGoniometer,
		buffer,
		{
			channels: 2,
			leftChannel: 0,
			rightChannel: 1,
			windowFrames: 2048,
			rotate45: false, // set true for classic “goniometer-ish” look
			persistence: 0.9, // higher = longer trails
			gain: 1.2,
			maxFps: 120
		}
	);

	goniometer.start();

	const widthMeterCanvas =
		document.querySelector<HTMLCanvasElement>('#width')!;
	const widthMeter = new SharedRingBufferStereoWidthMeter(
		widthMeterCanvas,
		buffer,
		{
			channels: 2,
			leftChannel: 0,
			rightChannel: 1,
			windowFrames: 1024,
			maxWidth: 2.0,
			attackMs: 40,
			releaseMs: 250,
			peakHoldMs: 700,
			maxFps: 60
		}
	);

	widthMeter.start();

	for (let i = 0; i < 16; i++) {
		const canvas3 = document.querySelector<HTMLCanvasElement>(
			`#scope${i + 1}`
		)!;

		const scope = new SharedRingBufferWaveform(canvas3, bufferSeparate, {
			channels: 16,
			channel: i, // or 1, or "mix"
			windowFrames: 1200, // tweak: 512/1024/2048
			trigger: true,
			triggerLookbackFrames: 600,
			gain: 2,
			maxFps: 120
		});

		scope.start();
	}
}
