import type { Sampler, SamplerInstance } from './Sampler';

const A4 = 81; // Key index bias

class Channel {
	bendBase = 0; // Pitch bend base ratio
	bendOut = 1; // Effective channel frequency ratio
	bendRange = 2; // Pitch bend magnitude
	index: number | undefined; // Index in sampler
	notesOn: Array<Note | null> = []; // All notes currently on keys
	notesOut: Array<Note> = []; // All notes that are generating output
	volLeft = 0.5; // Left stereo amplitude
	volLevel = 1; // Channel output amplitude
	volPanning = 0.5; // Stereo level
	volRight = 0.5; // Right stereo amplitude
}

class Note {
	advance: number | undefined; // Amount to increment phase per frame
	channel: Channel | undefined; // Encapsulating channel
	freqBase: number | undefined; // Base frequency
	playing = false; // Note is currently active on its key
	volBase: number | undefined; // Base volume
	volLeftLevel: number | undefined; // Current left stereo volume
	volLeftTarget: number | undefined; // Target left stereo volume
	volRightLevel: number | undefined; // Current right stereo volume
	volRightTarget: number | undefined; // Target right stereo volume
	wavPhase: number | undefined; // Position in wave period
}

/**
 * Rudimentary sample generator that uses sine waves for everything. This class
 * is intended for basic testing and is not suitable for general use.
 * @see Sampler
 */
export class SineSampler implements Sampler {
	/**
	 * Produces an instance of this sampler that can be used to render samples.
	 * @param sampleRate The output sampling rate of the rendered samples.
	 * @return A new sampler instance that can render samples using the current
	 * configuration of this sampler itself.
	 * @exception IllegalArgumentException if {@code sampleRate} is a
	 * non-number or is less than or equal to zero.
	 */
	public instance(sampleRate: number): SamplerInstance {
		if (!Number.isFinite(sampleRate) || sampleRate <= 0)
			throw new Error('Invalid sampling rate.');
		return new Instance(sampleRate);
	}
}

class Instance implements SamplerInstance {
	// instance fields
	channels: Array<Channel>; // Channel states
	masterTune = 1; // Global pitch bend
	masterVolume = 1; // Global volume
	sampleRate: number; // Output sampling rate
	volRate: number; // Automatic volume adjustment rate

	//////////////////////////// Constructors /////////////////////////////

	constructor(sampleRate: number) {
		// Instance fields
		this.channels = new Array<Channel>(16);
		this.sampleRate = sampleRate;
		this.volRate = 1 / (sampleRate * 0);

		// Channels
		for (let x = 0; x < this.channels.length; x++) {
			const chan = (this.channels[x] = new Channel());
			chan.index = x;
			chan.notesOn = new Array<Note>(127); // C-2 .. G8
			chan.notesOut = [];
		}

		// Reset all state
		this.reset();
	}

	/////////////////////////// Public Methods ////////////////////////////

	// Specify a channel's program bank.
	public bankChange(channel: number, bank: number): void {
		// Not implementing
	}

	// Specify whether a channel should play drum notes.
	public drumEnable(channel: number, enable: boolean): number {
		// Not implementing
		return 0;
	}

	// Determine whether or not any notes are producing output.
	public isFinished(): boolean {
		for (const chan of this.channels) {
			if (chan.notesOut.length != 0) return false;
		}
		return true;
	}

	// Deactivate a key that has previously been activated on a channel.
	public keyOff(channel: number, key: number): void {
		if (
			channel < 0 ||
			channel >= this.channels.length ||
			A4 + key < 0 ||
			A4 + key >= 128
		)
			return;
		const chan = this.channels[channel];
		const note = chan.notesOn?.[A4 + key];
		if (note != null) {
			note.playing = false;
			note.volBase = 0;
		}
	}

	// Activate a key on a channel.
	public keyOn(channel: number, key: number, velocity: number): void {
		// Error checking
		if (!Number.isFinite(velocity) || velocity < 0)
			throw new Error('Invalid velocity.');
		if (
			channel < 0 ||
			channel >= this.channels.length ||
			A4 + key < 0 ||
			A4 + key >= 128
		)
			return;

		// Working variables
		let chan = this.channels[channel];
		let note = chan.notesOn[A4 + key];

		// No note is currently playing on the specified key
		if (!note) {
			note = chan.notesOn[A4 + key] = new Note();
			chan.notesOut.push(note);
			note.channel = chan;
			note.volLeftLevel = 0;
			note.volRightLevel = 0;
			note.wavPhase = 0;
		}

		// Configure fields
		note.freqBase = 440 * Math.pow(2, key / 12.0);
		note.playing = true;
		note.volBase = velocity;
	}

	// Specify the global pitch bend.
	public setMasterTune(semitones: number): void {
		if (!Number.isFinite(semitones)) throw new Error('Invalid semitones.');
		this.masterTune = Math.pow(2, semitones);
	}

	// Specify the global volume.
	public setMasterVolume(volume: number): void {
		if (!Number.isFinite(volume) || volume < 0)
			throw new Error('Invalid volume.');
		this.masterVolume = volume;
	}

	// Specify stereo panning on a channel.
	public panpot(channel: number, panpot: number): void {
		if (!Number.isFinite(panpot) || panpot < -1 || panpot > 1)
			throw new Error('Invalid panpot.');
		if (channel < 0 || channel >= this.channels.length) return;
		const chan = this.channels[channel];
		chan.volPanning = (panpot + 1) / 2;
		chan.volLeft = (1 - chan.volPanning) * chan.volLevel;
		chan.volRight = chan.volPanning * chan.volLevel;
	}

	// Specify a channel's pitch bend.
	public pitchBend(channel: number, semitones: number): void {
		if (!Number.isFinite(semitones)) throw new Error('Invalid semitones.');
		if (channel < 0 || channel >= this.channels.length) return;
		const chan = this.channels[channel];
		chan.bendBase = semitones;
		chan.bendOut = Math.pow(2, chan.bendBase * chan.bendRange);
	}

	// Specify the range of a channel's pitch bend.
	public pitchBendRange(channel: number, range: number): void {
		if (!Number.isFinite(range) || range < 0)
			throw new Error('Invalid range.');
		if (channel < 0 || channel >= this.channels.length) return;
		const chan = this.channels[channel];
		chan.bendRange = range;
		chan.bendOut = Math.pow(2, chan.bendBase * chan.bendRange);
	}

	// Specify a channel's program number.
	public programChange(channel: number, program: number): void {
		// Not implementing
	}

	// Generate output samples.
	public render(samples: number[], offset: number, frames: number): void {
		this.render(samples, offset, frames, 1, true, true);
	}

	// Generate output samples.
	public render(
		samples: number[],
		offset: number,
		frames: number,
		amplitude: number
	): void {
		this.render(samples, offset, frames, amplitude, true, true);
	}

	// Generate output samples.
	public render(
		samples: number[],
		offset: number,
		frames: number,
		amplitude: number,
		erase: boolean,
		clamp: boolean
	): void {
		this.render(
			samples,
			offset,
			frames,
			amplitude,
			amplitude,
			erase,
			clamp
		);
	}

	// Generate output samples.
	public render(
		samples: number[],
		offset: number,
		frames: number,
		left: number,
		right: number
	): void {
		this.render(samples, offset, frames, left, right, true, true);
	}

	// Generate output samples.
	public render(
		samples: number[],
		offset: number,
		frames: number,
		left: number,
		right: number,
		erase: boolean,
		clamp: boolean
	): void {
		// Error checking
		if (samples == null) throw new Error('A sample buffer is required.');
		if (frames < 0) throw new Error('Invalid frames.');
		if (offset < 0 || offset + frames * 2 > samples.length) {
			throw new Error('Invalid range in sample buffer.');
		}
		if (!Number.isFinite(left) || left < 0)
			throw new Error('Invalid left.');
		if (!Number.isFinite(right) || right < 0)
			throw new Error('Invalid right.');

		// Erase the output buffer
		if (erase) {
			for (let x = frames * 2 - 1; x >= 0; x--) samples[offset + x] = 0;
		}

		// Render output samples
		for (const chan of this.channels)
			this.chanRender(chan, samples, offset, frames, left, right);

		// Clamp the output buffer
		if (clamp) {
			for (let x = frames * 2 - 1; x >= 0; x--) {
				samples[offset + x] = Math.min(
					Math.max(samples[offset + x], -1),
					1
				);
			}
		}
	}

	// Initialize all output state.
	public reset(): void {
		// Global fields
		this.masterTune = 1;
		this.masterVolume = 1;

		// Channels
		for (const chan of this.channels) {
			chan.bendBase = 0;
			chan.bendOut = 1;
			chan.bendRange = 2;
			chan.volLevel = 1;
			chan.volPanning = 0.5;
			chan.volLeft = 0.5;
			chan.volRight = 0.5;

			// Stop playing all notes
			for (let x = 0; x < chan.notesOn.length; x++)
				chan.notesOn[x] = null;
			for (const note of chan.notesOut) {
				note.playing = false;
				note.volBase = 0;
			}
		}
	}

	// Terminate all active notes.
	public stopAll(): void {
		for (const chan of this.channels) {
			for (let x = 0; x < chan.notesOn.length; x++)
				chan.notesOn[x] = null;
			for (const note of chan.notesOut) {
				note.playing = false;
				note.volBase = 0;
			}
		}
	}

	// Process a SysEx message.
	public sysEx(message: Uint8Array): void {
		// Not implementing
	}

	// Specify a channel's volume
	public volume(channel: number, volume: number): void {
		if (!Number.isFinite(volume) || volume < 0)
			throw new Error('Invalid volume.');
		if (channel < 0 || channel >= this.channels.length) return;
		const chan = this.channels[channel];
		chan.volLevel = volume;
		chan.volLeft = (1 - chan.volPanning) * chan.volLevel;
		chan.volRight = chan.volPanning * chan.volLevel;
	}

	/////////////////////////// Private Methods ///////////////////////////

	// Render samples on a channel
	private chanRender(
		chan: Channel,
		samples: number[],
		offset: number,
		frames: number,
		left: number,
		right: number
	): void {
		// Working variables
		const bend = this.masterTune * chan.bendOut;
		left *= chan.volLeft;
		right *= chan.volRight;

		// Process all notes
		for (let x = 0; x < chan.notesOut.length; x++) {
			if (
				this.noteRender(
					chan.notesOut[x],
					samples,
					offset,
					frames,
					chan.volLeft * left,
					chan.volRight * right,
					bend
				)
			)
				chan.notesOut.splice(x--, 1);
		}

		// Disassociate inactive notes
		for (let x = 0; x < chan.notesOn.length; x++) {
			const note = chan.notesOn[x];
			if (note != null && !note.playing) chan.notesOn[x] = null;
		}
	}

	// Perform easing on an amplitude controller
	private ease(level: number, target: number): number {
		return level < target
			? Math.min(target, level + this.volRate)
			: level > target
				? Math.max(target, level - this.volRate)
				: level;
	}

	// Render samples on a note
	private noteRender(
		note: Note,
		samples: number[],
		offset: number,
		frames: number,
		left: number,
		right: number,
		bend: number
	): boolean {
		// Working variables
		const freq = note.freqBase * bend;
		const advance = freq / this.sampleRate;

		// Compute desired left and right volume levels
		note.volLeftTarget = note.volBase * left;
		note.volRightTarget = note.volBase * right;

		// Process all samples
		for (let x = 0; x < frames; x++) {
			// Generate one sample
			const sample = this.sample(note, advance);
			samples[offset++] += sample * note.volLeftLevel;
			samples[offset++] += sample * note.volRightLevel;

			// Adjust stereo levels
			note.volLeftLevel = this.ease(
				note.volLeftLevel,
				note.volLeftTarget
			);
			note.volRightLevel = this.ease(
				note.volRightLevel,
				note.volRightTarget
			);

			// Note has finished
			if (
				!note.playing &&
				note.volLeftLevel == 0 &&
				note.volRightLevel == 0
			)
				return true;
		}

		// Note has not finished
		return false;
	}

	// Generate a sample on a note
	private sample(note: Note, advance: number): number {
		const ret = Math.sin(note.wavPhase * Math.PI * 2);
		note.wavPhase = (note.wavPhase + advance) % 1;
		return ret;
	}

	// Process a SysExt message
	public sysExt(message: Uint8Array): void {
		// Not implementing
	}

	// Move a volume level closer to its target
	private volAdjust(level: number, target: number): number {
		return level < target
			? Math.min(level + this.volRate, target)
			: Math.max(level - this.volRate, target);
	}
}
