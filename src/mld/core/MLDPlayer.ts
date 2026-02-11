import { MLD, type MLDTrack, type MLDEvent } from './MLD';
import type { Sampler, SamplerInstance } from './Sampler';

const A4 = 48; // Key index bias

/**
 * Notifies of a scenario that arises during playback. When configured, the
 * {@code render()} methods will terminate early any time an event
 * condition is satisfied. Events are obtained by the caller and
 * acknowledged via {@link getEvents()}.
 * @see getEvents()
 */
class Event {
	/**
	 * Additional event data, if relevant. For {@code EVENT_KEY} events,
	 * this will be the key number.
	 */
	public data: number;

	/**
	 * Time in seconds since the beginning of playback when the event was
	 * raised.
	 */
	public time: number;

	/**
	 * Indicates the type of event that was raised: {@code EVENT_END},
	 * {@code EVENT_KEY} or {@code EVENT_LOOP}.
	 */
	public type: number;

	// Internal constructor
	constructor(time: number, type: number, data: number) {
		this.data = data;
		this.time = time;
		this.type = type;
	}
}

///////////////////////////////// Classes /////////////////////////////////

// Playback channel
class Channel {
	notesOn: Array<Note | null> = []; // All notes currently on keys
	notesOut: Note[] = []; // All notes that are generating output
}

// Music note
class Note {
	channel = 0; // Output channel
	gateTime = 0; // Ticks before note expires
	key = 0; // Key index
}

// Event list state
class Track {
	cuepoint = 0; // Starting cuepoint
	finished = false; // Track has no more events
	index = 0; // Index within sequencer
	mld: MLDTrack; // Event list
	offset = 0; // Current event offset
	ticks = 0; // Event ticks until next event
	constructor(mld: MLDTrack, index: number) {
		this.mld = mld;
		this.index = index;
	}
}

/**
 * i-melody MLD sequence player. Uses a {@code Sampler} to generate output to a
 * sample buffer.
 * @see MLD
 * @see Sampler
 */
export class MLDPlayer {
	// Instance fields
	private channels: Channel[]; // Playback channels
	private events: Event[]; // Pending events
	private evtKeys: Set<number>; // Key events enabled by key
	private evtPlayback: boolean; // Playback events are enabled
	private finished = false; // Sequencer has no more events
	private framesPerTick = 0; // Output frames in one tick
	private loopEnabled: boolean; // Looping is enabled
	private loopStopAll: boolean; // Stop all notes when looping
	private mld: MLD; // Sequence resource
	private pendingFrames = 0; // Output frames to process
	private pendingTicks = 0; // Sequencer ticks to process
	private position = 0; // Sequencer position in frames
	private sampler: SamplerInstance; // Sample generator
	private sampleRate: number; // Output sampling rate
	private seeking: boolean; // Processing setTime()
	private tickNow = 0; // Sequencer position in ticks
	private tracks: Track[]; // Sequencer state

	//////////////////////////////// Constants ////////////////////////////////

	/**
	 * Event type that notifies when a non-looping sequence finishes.
	 * @see Event
	 */
	public static EVENT_END = 0;

	/**
	 * Event type that notifies when a sequence loops.
	 * @see Event
	 */
	public static EVENT_LOOP = 1;

	/**
	 * Event type that notifies when a particular key is played.
	 * @see Event
	 */
	public static EVENT_KEY = 2;

	////////////////////////////// Constructors ///////////////////////////////

	/**
	 * Begin MLD playback. Instances of a {@code Sampler} are used in
	 * conjunction with the given sampling rate to render the sequence to a
	 * sample buffer.
	 * @param mld The MLD sequence to play.
	 * @param sampler A {@code Sampler} from which instances will be taken to
	 * generate output.
	 * @param sampleRate The samples per second of the output.
	 * @exception Error if {@code mld} or {@code sampler} is
	 * {@code null}.
	 * @exception Error if {@code sampleRate} is a
	 * non-number or is less than or equal to zero.
	 * @see MLD
	 * @see Sampler
	 */
	constructor(mld: MLD, sampler: Sampler, sampleRate: number) {
		// Error checking
		if (mld == null) throw new Error('An MLD is required.');
		if (sampler == null) throw new Error('A sampler is required.');
		if (!Number.isFinite(sampleRate) || sampleRate <= 0.0)
			throw new Error('Invalid sampling rate.');

		// Instance fields
		this.channels = new Array<Channel>(16);
		this.events = [];
		this.evtKeys = new Set<number>();
		this.evtPlayback = false;
		this.loopEnabled = true;
		this.loopStopAll = true;
		this.mld = mld;
		this.sampler = sampler.instance(sampleRate);
		this.sampleRate = sampleRate;
		this.seeking = false;
		this.tracks = new Array<Track>(mld.tracks.length);

		// Channels
		for (let i = 0; i < this.channels.length; i++) {
			const chan = (this.channels[i] = new Channel());
			chan.notesOn = new Array<Note>(99); // A0 .. C6
			chan.notesOut = [];
		}

		// Tracks
		for (let i = 0; i < this.tracks.length; i++) {
			this.tracks[i] = new Track(mld.tracks[i], i);
		}

		// Prepare for playback
		this.reset();
	}

	///////////////////////////// Public Methods //////////////////////////////

	/**
	 * Registers a key to raise events for during rendering. Key number 0 is
	 * the note A<sub>4</sub>.
	 * @param key A key number to register.
	 * @see Event
	 * @see getEvents()
	 */
	public addEventKey(key: number): void {
		this.evtKeys.add(key);
	}

	/**
	 * Registers multiple keys to raise events for during rendering. Key number
	 * 0 is the note A<sub>4</sub>.
	 * @param keys A list of key numbers to register.
	 * @exception Error if {@code keys} is {@code null}.
	 * @see Event
	 * @see getEvents()
	 */
	public addEventKeys(keys: number[]): void {
		if (keys == null) throw new Error('Key array is required.');
		for (const key of keys) this.evtKeys.add(key);
	}

	/**
	 * Determine the total length of the sequence in seconds. Equivalent to
	 * invoking {@code getDuration(withoutLoops)} on the underlying {@code MLD}
	 * object.
	 * @param withoutLooping Whether or not to consider looping in the return
	 * value.
	 * @return If the sequence does not loop, the number of seconds in the
	 * sequence. If the sequence loops and {@code withoutLooping} is
	 * {@code false}, returns {@code Double.POSITIVE_INFINITY}. If the sequence
	 * loops and {@code withoutLooping} is {@code true}, returns the number of
	 * seconds in the sequence up until the first loop occurs.
	 * @see MLD#getDuration(boolean)
	 */
	public getDuration(withoutLooping: boolean): number {
		return this.mld.getDuration(withoutLooping);
	}

	/**
	 * Retrieve and acknowledge all pending events. If this method is not
	 * called, events will remain in the queue and prevent samples from being
	 * rendered.
	 * @return An array of all pending events, now acknowledged.
	 * @see Event
	 * @see addEventKey(int)
	 * @see addEventKeys(int[])
	 * @see setPlaybackEventsEnabled(boolean)
	 */
	public getEvents(): Event[] {
		const ret = this.events; // copy maybe?
		this.events = [];
		return ret;
	}

	/**
	 * Determine whether looping is enabled.
	 * @return {@code true} if looping is enabled.
	 * @see setLoopEnabled(boolean)
	 */
	public getLoopEnabled(): boolean {
		return this.loopEnabled;
	}

	/**
	 * Determine whether notes are stopped when looping.
	 * @return {@code true} if all notes are stopped when looping.
	 * @see setLoopStopAll(boolean)
	 */
	public getLoopStopAll(): boolean {
		return this.loopStopAll;
	}

	/**
	 * Retrieve the current playback position in the sequence. The range of
	 * values represents the start of the sequence at 0.0 and either the end of
	 * the sequence or the point where looping occurs at 1.0.
	 * @return The proportion of the total sequence for the current playback
	 * position.
	 */
	public getPosition(): number {
		return this.tickNow / this.mld.tickEnd;
	}

	/**
	 * Retrieve the total number of seconds played back so far.
	 * @return The number of seconds processed, relative to the start of the
	 * sequence.
	 * @see setTime(double)
	 * @see MLD#getDuration(boolean)
	 */
	public getTime(): number {
		return this.position / this.sampleRate;
	}

	/**
	 * Determine whether playback has completed. The sequence is considered
	 * finished when all of its events have been processed and the last note
	 * has stopped generating samples.
	 * @return {@code true} if all playback has completed.
	 */
	public isFinished(): boolean {
		if (!this.sampler.isFinished()) return false;
		for (const track of this.tracks) {
			if (!track.finished) return false;
		}
		return true;
	}

	/**
	 * Unregisters a keys from raising events during rendering.
	 * @param key A key number to unregister.
	 * @see Event
	 * @see getEvents()
	 */
	public removeEventKey(key: number): void {
		this.evtKeys.delete(key);
	}

	/**
	 * Unregisters multiple keys from raising events during rendering.
	 * @param keys A list of key numbers to unregister.
	 * @exception Error if {@code keys} is {@code null}.
	 * @see Event
	 * @see getEvents()
	 */
	public removeEventKeys(keys: number[]): void {
		if (keys == null) throw new Error('Key array is required.');
		for (const key of keys) this.evtKeys.delete(key);
	}

	/**
	 * Generate output samples. <br><br>
	 * For information regarding the operations of this method, see
	 * {@link Sampler.Instance#render(float[],int,int,float,float,boolean,boolean)}.
	 * <br><br>
	 * If an event is raised during playback, rendering will stop and return
	 * before generating any more samples. When this happens, the return value
	 * may be less than {@code frames}. {@link getEvents()} should be called
	 * after every call to {@code render()} while events are enabled.
	 * @param samples Output sample buffer.
	 * @param offset Index in {@code samples} of the first audio frame to
	 * output.
	 * @param frames The number of audio frames to output.
	 * @param left A multiplier that is applied to all left-stereo samples
	 * generated.
	 * @param right A multiplier that is applied to all right-stereo samples
	 * generated.
	 * @param erase Replace the buffer contents when {@code true}, or add
	 * to them when {@code false}
	 * @param clamp Specifies whether to restrict the sample buffer values
	 * to -1.0f to +1.0f inclusive.
	 * @return The number of samples generated, or -1 if playback has finished.
	 * May be less than {@code frames} if playback of the underlying sequence
	 * completes before all frames have been processed.
	 * @exception Error if {@code samples} is {@code null}.
	 * @exception ArrayIndexOutOfBoundsException if {@code offset} is
	 * negative, or if {@code offset + frames * 2 > samples.length}.
	 * @exception Error if {@code frames} is negative, or if
	 * {@code left} or {@code right} is a non-number or is negative.
	 * @see Sampler.Instance#render(float[],int,int,float,float,boolean,boolean)
	 * @see getEvents()
	 * @see render(float[],int,int)
	 * @see render(float[],int,int,float)
	 * @see render(float[],int,int,float,float)
	 */
	public render(
		samples: Float32Array | null,
		offset: number,
		frames: number,
		left = 1,
		right = 1,
		erase = true,
		clamp = true
	): number {
		let ret = 0; // Total frames output so far

		// Error checking
		if (!this.seeking) {
			if (samples == null)
				throw new Error('A sample buffer is required.');
			if (frames < 0) throw new Error('Invalid frames.');
			if (offset < 0 || offset + frames * 2 > samples.length) {
				throw new Error('Invalid range in sample buffer.');
			}
			if (!Number.isFinite(left) || left < 0.0)
				throw new Error('Invalid left amplitude.');
			if (!Number.isFinite(right) || right < 0.0)
				throw new Error('Invalid right amplitude.');
		}

		// Sequencer is not playing
		if (this.finished) this.pendingFrames = frames;

		// Process all output frames
		while (frames > 0) {
			// Events are pending
			if (this.events.length != 0) return ret;

			// Process output frames
			while (this.pendingFrames > 0) {
				// Render the samples
				const f = Math.min(frames, Math.floor(this.pendingFrames));
				if (!this.seeking)
					this.sampler.render(
						samples!,
						offset,
						f,
						left,
						right,
						erase,
						clamp
					);

				// State management
				frames -= f;
				offset += f * 2;
				this.pendingFrames -= f;
				this.position += f;
				ret += f;

				// All output frames have been processed
				if (frames == 0) return this.finished ? -1 : ret;
			}

			// Process event ticks
			if (this.pendingTicks > 0) {
				// Sequencer
				this.tickNow += this.pendingTicks;

				// Notes
				for (const chan of this.channels)
					for (const note of chan.notesOut)
						note.gateTime -= this.pendingTicks;

				// Tracks
				for (const track of this.tracks)
					this.process(track, this.pendingTicks);

				// Remove expired notes
				for (const chan of this.channels)
					for (let i = 0; i < chan.notesOut.length; i++) {
						const note = chan.notesOut[i];
						if (note.gateTime != 0) continue;
						this.sampler.keyOff(note.channel, note.key);
						chan.notesOut.splice(i--, 1);
						chan.notesOn[A4 + note.key] = null;
					}
			}

			// Determine how many ticks and frames can be processed next
			const untilTrack = this.untilTrack();
			if (untilTrack == -1) {
				this.finished = true;
				return ret;
			}
			const untilNote = this.untilNote();
			this.pendingTicks =
				untilNote == -1 ? untilTrack : Math.min(untilTrack, untilNote);
			this.pendingFrames += Math.floor(
				this.pendingTicks * this.framesPerTick
			);
		}

		return ret;
	}

	/**
	 * Initialize state in preparation for playback. All notes are stopped and
	 * all sequencer state is reset to the beginning of the sequence.
	 */
	public reset(): void {
		// Instance fields
		this.pendingFrames = 0;
		this.pendingTicks = 0;
		this.position = 0;
		this.tickNow = 0;
		this.setTempo(48, 125);
		this.events = [];

		// Initialize sampler
		this.sampler.reset();

		// Channels
		for (const chan of this.channels) {
			for (let i = 0; i < chan.notesOn.length; i++)
				chan.notesOn[i] = null;
			chan.notesOut = [];
		}

		// Tracks
		for (const track of this.tracks) {
			track.cuepoint = -1;
			track.offset = track.mld.cue;
			track.ticks = 0;
			track.finished = track.offset >= track.mld.length;
		}

		// Initialize playback
		this.finished = true;
		for (const track of this.tracks) {
			this.process(track, 0);
			this.finished = this.finished && track.finished;
		}
	}

	/**
	 * Specify whether to enable looping. When disabled, loop points defined in
	 * the sequence data will not be processed.
	 * @param enabled If {@code true}, looping will be enabled.
	 * @return the value of {@code enabled}
	 * @see getLoopEnabled()
	 */
	public setLoopEnabled(enabled: boolean): boolean {
		return (this.loopEnabled = enabled);
	}

	/**
	 * Specify whether to stop all notes when looping. If notes are not
	 * stopped, it is possible for adjustments to volume or pitch-bend to
	 * affect ongoing notes in undesirable ways. If notes <i>are</i> stopped,
	 * it is possible for ongoing notes to be truncated in undesirable ways.
	 * @param stopAll If {@code true}, all notes will be stopped when looping.
	 * @return the value of {@code stopAll}
	 * @see getLoopStopAll()
	 */
	public setLoopStopAll(stopAll: boolean): boolean {
		return (this.loopStopAll = stopAll);
	}

	/**
	 * Specify whether or not to raise playback events. Playback events include
	 * {@code EVENT_END} and {@code EVENT_LOOP}.
	 * @param enabled Whether or not playback events can be raised during
	 * rendering.
	 * @see Event
	 * @see getEvents()
	 */
	public setPlaybackEventsEnabled(enabled: boolean): void {
		this.evtPlayback = enabled;
	}

	/**
	 * Specify the playback position of the sequence in seconds. The resulting
	 * position in the sequence will be the earliest internal time at or after
	 * {@code seconds}.<br><br>
	 * If the end of the sequence is encountered during seeking, this method
	 * will return {@code true}. When this happens, it is possible that the
	 * position in the sequence retrieved by subsequent calls to
	 * {@code getTime()} may be less than {@code seconds}.
	 * @param seconds The number of seconds from the beginning of the sequence.
	 * @return {@code true} if the end of the sequence was encountered during
	 * the operation.
	 * @exception Error if {@code seconds} is a non-number
	 * or is negative.
	 * @see getTime()
	 * @see MLD#getDuration(boolean)
	 */
	public setTime(seconds: number): boolean {
		// Error checking
		if (!Number.isFinite(seconds) || seconds < 0)
			throw new Error('Invalid seconds.');

		// Compute the target number of frames
		const target = Math.ceil(seconds * this.sampleRate);

		// Already at the target
		if (target == this.position) return this.isFinished();

		// Target is earlier than the current frame
		if (target < this.position) this.reset();

		// Seek forward to the target time
		this.seeking = true;
		this.render(null, 0, target - this.position, 0.0, 0.0, false, false);
		this.seeking = false;
		return this.isFinished();
	}

	///////////////////////////// Private Methods /////////////////////////////

	// Process events on a track
	private process(track: Track, ticks: number): void {
		// The track has finished
		if (track.finished) return;

		// Update state
		track.ticks -= ticks;
		if (track.ticks > 0) return;

		// Process all events this tick
		while (track.ticks == 0) {
			const event = track.mld[track.offset];

			// Process the event
			switch (event.type) {
				case MLD.EVENT_TYPE_NOTE:
					this.evtNote(track, event);
					break;
				case MLD.EVENT_TYPE_EXT_B:
					this.evtExtB(track, event);
					break;
				case MLD.EVENT_TYPE_EXT_INFO:
					this.evtExtInfo(track, event);
					break;
				default:
					this.setTrackOffset(track, track.offset + 1);
			}

			// Stop processing events
			if (track.finished) return;

			// Schedule the next event
			track.ticks = track.mld[track.offset].delta;
		}
	}

	// Compute the number of output frames in one event tick
	private setTempo(timebase: number, tempo: number): void {
		this.framesPerTick = (60 * this.sampleRate) / (timebase * tempo);
	}

	// Specify the event offset of a track
	private setTrackOffset(track: Track, offset: number): void {
		// Configure the track
		track.offset = offset;
		track.finished = offset >= track.mld.length;

		// Raise an event
		if (!track.finished || !this.evtPlayback) return;
		let finished = true;
		for (const other of this.tracks) finished = finished && other.finished;
		if (finished)
			this.events.push(new Event(this.getTime(), MLDPlayer.EVENT_END, 0));
	}

	// Determine how many ticks can be processed until a note expires
	private untilNote(): number {
		let ret = -1;
		for (const chan of this.channels)
			for (const note of chan.notesOut) {
				if (ret == -1 || note.gateTime < ret) ret = note.gateTime;
			}
		return ret;
	}

	// Determine how many ticks can be processed until the next event
	private untilTrack(): number {
		let ret = -1;
		for (const track of this.tracks) {
			if (track.finished) continue;
			if (ret == -1 || track.ticks < ret) ret = track.ticks;
		}
		return ret;
	}

	////////////////////////////// Event Methods //////////////////////////////

	// bank-change
	private evtBankChange(track: Track, event: MLDEvent): void {
		this.sampler.bankChange(event.channel, event.bank);
		this.setTrackOffset(track, track.offset + 1);
	}

	// cuepoint
	private evtCuepoint(track: Track, event: MLDEvent): void {
		// cuepoint-end
		if (
			event.cuepoint == MLD.CUEPOINT_END &&
			this.tracks[0].cuepoint != -1
		) {
			// Process only if looping is enabled
			if (this.loopEnabled) {
				if (this.loopStopAll) this.sampler.stopAll();
				for (const t of this.tracks) this.setTrackOffset(t, t.cuepoint);
				if (this.evtPlayback)
					this.events.push(
						new Event(this.getTime(), MLDPlayer.EVENT_LOOP, 0)
					);
			}

			// Looping is disabled
			else this.setTrackOffset(track, track.offset + 1);

			return;
		}

		// Common processing
		this.setTrackOffset(track, track.offset + 1);

		// cuepoint-start
		if (event.cuepoint == MLD.CUEPOINT_START) {
			for (const t of this.tracks) t.cuepoint = t.offset;
		}
	}

	// drum-enable
	private evtDrumEnable(track: Track, event: MLDEvent): void {
		this.sampler.drumEnable(event.channel, event.enable);
		this.setTrackOffset(track, track.offset + 1);
	}

	// end-of-track
	private evtEndOfTrack(track: Track, event: MLDEvent): void {
		track.finished = true;
	}

	// ext-B event
	private evtExtB(track: Track, e: MLDEvent): void {
		switch (e.id) {
			case MLD.EVENT_BANK_CHANGE:
				this.evtBankChange(track, e);
				break;
			case MLD.EVENT_CUEPOINT:
				this.evtCuepoint(track, e);
				break;
			case MLD.EVENT_END_OF_TRACK:
				this.evtEndOfTrack(track, e);
				break;
			case MLD.EVENT_MASTER_VOLUME:
				this.evtMasterVolume(track, e);
				break;
			case MLD.EVENT_MASTER_TUNE:
				this.evtMasterTune(track, e);
				break;
			case MLD.EVENT_PANPOT:
				this.evtPanPot(track, e);
				break;
			case MLD.EVENT_PITCHBEND:
				this.evtPitchBend(track, e);
				break;
			case MLD.EVENT_PITCHBEND_RANGE:
				this.evtPitchRange(track, e);
				break;
			case MLD.EVENT_PROGRAM_CHANGE:
				this.evtProgramChange(track, e);
				break;
			case MLD.EVENT_TIMEBASE_TEMPO:
				this.evtTimebaseTempo(track, e);
				break;
			case MLD.EVENT_VOLUME:
				this.evtVolume(track, e);
				break;
			case MLD.EVENT_X_DRUM_ENABLE:
				this.evtDrumEnable(track, e);
				break;

			// Not implemented
			//case EVENT_JUMP:
			//case EVENT_CHANNEL_ASSIGN:
			//case EVENT_NOP:
			//case EVENT_PART_CONFIGURATION:
			//case EVENT_PAUSE:
			//case EVENT_RESET:
			//case EVENT_STOP:
			//case EVENT_WAVE_CHANNEL_VOLUME:
			//case EVENT_WAVE_CHANNEL_PANPOT:

			// Unrecognized events
			default:
				this.setTrackOffset(track, track.offset + 1);
		}
	}

	// ext-info event
	private evtExtInfo(track: Track, e: MLDEvent): void {
		this.sampler.sysEx(e.data!);
		this.setTrackOffset(track, track.offset + 1);
	}

	// note
	private evtNote(track: Track, event: MLDEvent): void {
		const chan = this.channels[event.channel];
		let note = chan.notesOn[A4 + event.key];

		// Common processing
		this.setTrackOffset(track, track.offset + 1);

		// Raise an event
		if (this.evtKeys.has(event.key))
			this.events.push(
				new Event(this.getTime(), MLDPlayer.EVENT_KEY, event.key)
			);

		// Velocity 0 is regarded as key-off
		if (event.velocity == 0) {
			this.sampler.keyOff(event.channel, event.key);
			if (note != null) {
				chan.notesOn[A4 + event.key] = null;
				const index = chan.notesOut.indexOf(note);
				chan.notesOut.splice(index, 1);
			}
			return;
		}

		// Velocity not zero is regarded as key-on
		if (!this.seeking)
			this.sampler.keyOn(event.channel, event.key, event.velocity);

		// Get or create the note for this key
		if (note == null) {
			note = new Note();
			note.channel = event.channel;
			note.key = event.key;
			chan.notesOn[A4 + event.key] = note;
			chan.notesOut.push(note);
		}

		// Reconfigure the note
		note.gateTime = event.gateTime;
	}

	// master-volume
	private evtMasterVolume(track: Track, event: MLDEvent): void {
		this.sampler.setMasterVolume(event.volume);
		this.setTrackOffset(track, track.offset + 1);
	}

	// master-tune
	private evtMasterTune(track: Track, event: MLDEvent): void {
		this.sampler.setMasterTune(event.semitones);
		this.setTrackOffset(track, track.offset + 1);
	}

	// panpot
	private evtPanPot(track: Track, event: MLDEvent): void {
		this.sampler.panpot(event.channel, event.panpot);
		this.setTrackOffset(track, track.offset + 1);
	}

	// pitchbend
	private evtPitchBend(track: Track, event: MLDEvent): void {
		this.sampler.pitchBend(event.channel, event.semitones);
		this.setTrackOffset(track, track.offset + 1);
	}

	// pitchbend-range
	private evtPitchRange(track: Track, event: MLDEvent): void {
		this.sampler.pitchBendRange(event.channel, event.range);
		this.setTrackOffset(track, track.offset + 1);
	}

	// program-change
	private evtProgramChange(track: Track, event: MLDEvent): void {
		this.sampler.programChange(event.channel, event.program);
		this.setTrackOffset(track, track.offset + 1);
	}

	// timebase-tempo
	private evtTimebaseTempo(track: Track, event: MLDEvent): void {
		if (event.timebase == -1) return;
		const prev = this.framesPerTick;
		this.setTempo(event.timebase, event.tempo);
		this.pendingFrames = (this.pendingFrames * this.framesPerTick) / prev;
		this.setTrackOffset(track, track.offset + 1);
	}

	// volume
	private evtVolume(track: Track, event: MLDEvent): void {
		this.sampler.volume(event.channel, event.volume);
		this.setTrackOffset(track, track.offset + 1);
	}
}
