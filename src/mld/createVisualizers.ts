import type { SharedRingBuffer } from './SharedRingBuffer';

import { RingBufferAnalogVU } from './visualizers/RingBufferAnalogVU';
import { RingBufferVisualizer } from './visualizers/RingBufferVisualizer';

export function createVisualizers(buffer: SharedRingBuffer<Float32Array>) {
	const canvas = document.querySelector<HTMLCanvasElement>('#rb')!;
	const bufferVisualizer = new RingBufferVisualizer(canvas, buffer, {
		donutWidth: 3,
		showText: false,
		maxFps: 200
	});

	bufferVisualizer.start();

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
}
