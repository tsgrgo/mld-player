//////////////////////////////// Constants ////////////////////////////////

// Cuepoints
const CUEPOINT_START = 0;
const CUEPOINT_END = 1;

// Event types
const EVENT_TYPE_UNKNOWN = -1;
const EVENT_TYPE_NOTE = 0;
const EVENT_TYPE_EXT_B = 1;
const EVENT_TYPE_EXT_INFO = 2;

// Event ext-B IDs
const EVENT_MASTER_VOLUME = 0xb0;
const EVENT_MASTER_TUNE = 0xb3;
const EVENT_PART_CONFIGURATION = 0xb9;
const EVENT_PAUSE = 0xbd;
const EVENT_STOP = 0xbe;
const EVENT_RESET = 0xbf;
const EVENT_TIMEBASE_TEMPO = 0xc0;
const EVENT_CUEPOINT = 0xd0;
const EVENT_JUMP = 0xd1;
const EVENT_NOP = 0xde;
const EVENT_END_OF_TRACK = 0xdf;
const EVENT_PROGRAM_CHANGE = 0xe0;
const EVENT_BANK_CHANGE = 0xe1;
const EVENT_VOLUME = 0xe2;
const EVENT_PANPOT = 0xe3;
const EVENT_PITCHBEND = 0xe4;
const EVENT_CHANNEL_ASSIGN = 0xe5;
const EVENT_PITCHBEND_RANGE = 0xe7;
const EVENT_WAVE_CHANNEL_VOLUME = 0xe8;
const EVENT_WAVE_CHANNEL_PANPOT = 0xe9;
const EVENT_X_DRUM_ENABLE = 0xba;

// FourCCs
const FOURCC_ADAT = 0x61646174; // "adat"
const FOURCC_AINF = 0x61696e66; // "ainf"
const FOURCC_AUTH = 0x61757468; // "auth"
const FOURCC_COPY = 0x636f7079; // "copy"
const FOURCC_CUEP = 0x63756570; // "cuep"
const FOURCC_DATE = 0x64617465; // "date"
const FOURCC_EXST = 0x65787374; // "exst"
const FOURCC_MELO = 0x6d656c6f; // "melo"
const FOURCC_NOTE = 0x6e6f7465; // "note"
const FOURCC_PROT = 0x70726f74; // "prot"
const FOURCC_SORC = 0x736f7263; // "sorc"
const FOURCC_SUPT = 0x73757074; // "supt"
const FOURCC_THRD = 0x74687264; // "thrd"
const FOURCC_TITL = 0x7469746c; // "titl"
const FOURCC_TRAC = 0x74726163; // "trac"
const FOURCC_VERS = 0x76657273; // "vers"

// "note" types
const NOTE_3 = 0;
const NOTE_4 = 1;

///////////////////////////////// Classes /////////////////////////////////

// ADPCM sample data class
class ADPCM {
	data = new Uint8Array(); // Significance not yet known
}

// Sequencer event data class
class Event {
	// Instance fields
	data: Uint8Array | undefined; // ext-info and unknown event data
	channel = 0; // Normalized channel ID, out of 16
	delta = 0; // Time delta: number of ticks since last event
	id = 0; // Meta event ID
	key = 0; // Normalized key ID, relative to A4
	offset = 0; // Location in MLD asset
	param = 0; // Event parameter bits
	status = 0; // note-status, second byte of event data
	type = 0; // Event category

	// Note fields
	channelIndex = 0; // Channel index 0..3 within parent track
	gateTime = 0; // Number of ticks until note off
	keyNumber = 0; // Base key index
	octaveShift = 0; // Number of octaves to adjust keyNumber
	velocity = 0; // Base volume

	// ext-B fields
	bank = 0;
	cuepoint = 0;
	enable = false;
	jumpCount = 0;
	jumpId = 0;
	jumpPoint = 0;
	panpot = 0;
	program = 0;
	range = 0;
	semitones = 0;
	tempo = 0;
	timebase = 0;
	volume = 0;
}

// Utility class for reading binary data
class Reader {
	data: Uint8Array; // Backing data store
	length: number; // Length of current segment
	offset: number; // Current input offset
	start: number; // Offset of start of current segment

	// Constructor
	constructor(data: Uint8Array, start: number, length: number) {
		this.data = data;
		this.length = length;
		this.offset = start;
		this.start = start;
	}

	// Read a byte array
	bytes(length: number): Uint8Array {
		if (this.offset + length > this.start + this.length)
			throw new Error('Unexpected EOF.');

		const ret = this.data.slice(this.offset, this.offset + length);
		this.offset += length;
		return ret;
	}

	// Determine whether the stream has reached its end
	isEOF(): boolean {
		return this.offset == this.start + this.length;
	}

	// Produce a new Reader to access a subset of this one
	reader(length: number): Reader {
		const ret = new Reader(this.data, this.offset, length);
		this.skip(length);
		return ret;
	}

	// Advance the input
	skip(length: number): void {
		if (this.offset + length > this.start + this.length)
			throw new Error('Unexpected EOF.');
		this.offset += length;
	}

	// Read an 8-bit unsigned integer
	u8(): number {
		if (this.offset == this.start + this.length)
			throw new Error('Unexpected EOF.');
		return this.data[this.offset++] & 0xff;
	}

	// Read a 16-bit unsigned integer
	u16(): number {
		const ret = this.u8() << 8;
		return ret | this.u8();
	}

	// Read a 32-bit unsigned integer
	u32(): number {
		const ret = this.u16() << 16;
		if (ret < 0) throw new Error('Unsupported U32 value.');
		return ret | this.u16();
	}
}

// Event list
class Track extends Array<Event> {
	cue = 0; // Initial event offset on reset
	index = 0; // Channel index base
}

/**
 * Decoder for i-melody MLD sequences.
 */
export class MLD {
	// Instance fields
	adpcms: ADPCM[] = []; // Sample data
	duration = 0; // Total runtime in seconds, or POSITIVE_INFINITY
	header?: Uint8Array; // Encoded header chunk
	tickEnd = 0; // Tick count at the end of the last event
	tickLoop = -1; // Tick count of the loop destination
	tracks: Track[] = []; // Event lists

	// Content type header fields
	contentType: number = 0;
	hasFemaleVocals = false;
	hasImageData = false;
	hasMaleVocals = false;
	hasMusicEvents = false;
	hasOtherVocals = false;
	hasTextData = false;
	hasWaveData = false;

	// Header subchunks
	ainf?: Uint8Array;
	auth?: Uint8Array;
	copy?: string;
	cuep: number[] = [];
	date?: string;
	exst?: Uint8Array;
	note = NOTE_3;
	prot?: string;
	sorc?: number;
	supt?: string;
	thrd?: Uint8Array;
	titl?: string;
	vers?: string;

	////////////////////////////// Constructors ///////////////////////////////

	// /**
	//  * Decode from a byte array. Same as invoking
	//  * {@code MLD(data, 0, data.length)}.
	//  * @param data A byte array contining the MLD resource.
	//  * @exception NullPointerException if {@code data} is {@code null}.
	//  * @exception Error if an error occurs during decoding.
	//  * @see MLD(byte[],int,int)
	//  */
	// public MLD(byte[] data) {
	//     this(data, 0, data.length);
	// }

	/**
	 * Decode from a byte array. If the {@code length} argument specifies bytes
	 * beyond the end of the MLD resource, the extra bytes will not be
	 * processed.
	 * @param data A byte array contining the MLD resource.
	 * @param offset The position in {@code data} of the first byte of the MLD
	 * resource.
	 * @param length The number of bytes to consider when decoding the MLD
	 * resource. Must be greater than or equal to the size of the MLD.
	 * @exception NullPointerException if {@code data} is {@code null}.
	 * @exception IllegalArgumentException if {@code length} is negative.
	 * @exception ArrayIndexOutOfBoundsException if {@code offset} is negative
	 * or {@code offset + length > data.length}.
	 * @exception Error if an error occurs during decoding.
	 */
	constructor(data: Uint8Array /*, offset:number, length: number*/) {
		// Error checking
		if (data == null) throw new Error('A byte buffer is required.');
		// if (length < 0)
		//     throw new Error("Invalid length.");
		// if (offset < 0 || length >= 0 && offset + length > data.length) {
		//     throw new Error(
		//         "Invalid range in byte buffer.");
		// }

		this.parse(data);
	}

	// /**
	//  * Decode from an input stream. The data at the current position in the
	//  * stream must be an MLD resource.<br><br>
	//  * After returning, the stream will be at the position of the byte
	//  * following the MLD data. If an error occurs during decoding, the stream
	//  * position will be indeterminate.
	//  * @param in The stream to decode from.
	//  * @exception Error if an error occurs during decoding.
	//  * @throws IOException if a stream access error occurs.
	//  */
	// public MLD(InputStream in) throws IOException {
	//     parse(in instanceof DataInputStream ?
	//         (DataInputStream) in : new DataInputStream(in));
	// }

	// /**
	//  * Decode from an {@code Path}. The data at the start of the referenced
	//  * file must be an MLD resource.
	//  * @param path The path to decode from.
	//  * @exception Error if an error occurs during decoding.
	//  * @throws IOException if a path access error occurs.
	//  */
	// public MLD(Path path) throws IOException {
	//     parse(new DataInputStream(Files.newInputStream(path)));
	// }

	///////////////////////////// Public Methods //////////////////////////////

	/**
	 * Retrieve the copyright of the MLD resource.
	 * @return The copyright text if available, or {@code null} otherwise.
	 */
	public getCopyright(): string {
		return this.copy || '';
	}

	/**
	 * Retrieve the date of the MLD resource.
	 * @return The date text if available, or {@code null} otherwise.
	 */
	public getDate(): string {
		return this.date || '';
	}

	/**
	 * Determine the total length of the MLD sequence in seconds.
	 * @param withoutLooping Whether or not to consider looping in the return
	 * value.
	 * @return If the sequence does not loop, the number of seconds in the
	 * sequence. If the sequence loops and {@code withoutLooping} is
	 * {@code false}, returns {@code Double.POSITIVE_INFINITY}. If the sequence
	 * loops and {@code withoutLooping} is {@code true}, returns the number of
	 * seconds in the sequence up until the first loop occurs.
	 * @see MLDPlayer#getTime()
	 * @see MLDPlayer#setTime(double)
	 */
	public getDuration(withoutLooping: boolean): number {
		return withoutLooping || this.tickLoop == -1
			? this.duration
			: Number.POSITIVE_INFINITY;
	}

	/**
	 * Retrieve the title of the MLD resource.
	 * @return The title text if available, or {@code null} otherwise.
	 */
	public getTitle(): string {
		return this.titl || '';
	}

	/**
	 * Retrieve the version of the MLD resource.
	 * @return The version text if available, or {@code null} otherwise.
	 */
	public getVersion(): string {
		return this.vers || '';
	}

	///////////////////////////// Private Methods /////////////////////////////

	// Parse an ADPCM chunk
	private adpcm(reader: Reader): ADPCM {
		if (reader.u32() != FOURCC_ADAT)
			throw new Error('Missing "adat" chunk.');
		const ret = new ADPCM();
		ret.data = new Uint8Array(reader.bytes(reader.u32()));
		return ret;
	}

	// Measure the duration and tick counters
	private inspect(): void {
		let tempo = 60.0 / (48 * 128);
		let tickNow = 0;
		const trkPos = new Array<number>(this.tracks.length);
		const trkUntil = new Array<number>(this.tracks.length);

		// Initialize instance fields
		this.duration = 0.0;
		this.tickEnd = 0;
		this.tickLoop = -1;

		// Record the start time of each track's first event
		for (let i = 0; i < this.tracks.length; i++) {
			const track = this.tracks[i];
			if (track.length != 0) {
				trkPos[i] = 0;
				trkUntil[i] = track[0].delta;
			} else trkUntil[i] = -1;
		}

		// Inspect all events
		for (;;) {
			// Determine the number of ticks until the next event
			let until = -1;
			for (let i = 0; i < this.tracks.length; i++) {
				const tu = trkUntil[i];
				if (tu != -1 && (until == -1 || tu < until)) until = tu;
			}

			// All tracks have finished
			if (until == -1) break;

			// Advance to the next event
			this.duration += until * tempo;
			tickNow += until;
			this.tickEnd = Math.max(this.tickEnd, tickNow);

			for (let i = 0; i < this.tracks.length; i++) {
				if (trkUntil[i] != -1) trkUntil[i] -= until;
			}

			// Process all relevant events that happen right now
			for (let i = 0; i < this.tracks.length; i++) {
				// No more events right now on this track
				if (trkUntil[i] != 0) continue;

				// Retrieve the next event
				const track = this.tracks[i];
				const event = track[trkPos[i]++];

				// Additional events on this track
				if (trkPos[i] < track.length)
					trkUntil[i] = track[trkPos[i]].delta;
				// No more events ever on this track
				else trkUntil[i] = -1;

				// end-of-track
				if (
					event.type == EVENT_TYPE_EXT_B &&
					event.id == EVENT_END_OF_TRACK
				) {
					trkUntil[i] = -1;
					continue;
				}

				// Check this track again next iteration
				i--;

				// note
				if (event.type == EVENT_TYPE_NOTE) {
					this.tickEnd = Math.max(
						this.tickEnd,
						tickNow + event.gateTime
					);
					continue;
				}

				// Next must be ext-B
				if (event.type != EVENT_TYPE_EXT_B) continue;

				// timebase-tempo
				if ((event.id & 0xf0) == EVENT_TIMEBASE_TEMPO) {
					tempo = 60.0 / (event.timebase * event.tempo);
					continue;
				}

				// Next must be cuepoint
				if (event.id != EVENT_CUEPOINT) continue;

				// cuepoint start
				if (event.cuepoint == CUEPOINT_START) {
					this.tickLoop = tickNow;
					continue;
				}

				// cuepoint end, but the loop point isn't set
				if (this.tickLoop == -1) continue;

				// If a cuepoint end and note both happen on the
				// same tick and the cuepoint end is "first", does
				// it still play the note?

				// cuepoint end
				this.tickEnd = tickNow;
				return;
			}
		}

		// The entire sequence was scanned
		this.tickLoop = -1;
	}

	// Parse an MLD file
	private parse(bytes: Uint8Array): void {
		const view = new DataView(
			bytes.buffer,
			bytes.byteOffset,
			bytes.byteLength
		);

		// File signature
		const sig = view.getInt32(0, false);
		if (sig != FOURCC_MELO) throw new Error('Missing "melo" signature.');

		// File length
		const length = view.getInt32(4, false);
		if (length < 0) throw new Error('Unsupported file length.');

		// Read the file into a byte array
		const total = 8 + length;

		if (bytes.length < total) throw new Error('Unexpected EOF.');

		const data = bytes.slice(0, total);

		console.log('length', length);
		console.log('data', data);

		// Default fields
		this.adpcms = [];
		this.note = NOTE_3;

		// Working variables
		const reader = new Reader(data, 8, length);

		// Parse the file
		this.parseHeader(reader);

		for (let i = 0; i < this.adpcms.length; i++)
			this.adpcms[i] = this.adpcm(reader);

		for (let i = 0; i < this.tracks.length; i++)
			this.tracks[i] = this.parseTrack(this.note, i, reader);

		// Measure the duration and tick counters
		this.inspect();
	}

	// Parse a track
	private parseTrack(note: number, index: number, reader: Reader): Track {
		// Error checking
		if (reader.u32() != FOURCC_TRAC)
			throw new Error('Missing "trac" chunk.');

		// Working variables
		const ret = new Track();
		ret.index = index;
		reader = reader.reader(reader.u32());
		const cue = reader.offset + this.cuep[index];

		// Parse events
		while (!reader.isEOF()) {
			if (reader.offset == cue) ret.cue = ret.length;
			ret.push(this.event(note, index, reader));
		}
		return ret;
	}

	// Decode a string as Shift_JIS
	private shiftJIS(bytes: Uint8Array): string {
		try {
			return new TextDecoder('Shift_JIS').decode(bytes);
		} catch (e) {
			return '';
		}
	}

	// Convert a volume parameter to a linear amplitude
	private volumeToAmplitude(param: number): number {
		return param == 0 ? 0 : Math.pow(2, ((1 - param) * -96) / 20);
	}

	///////////////////////// Header Parsing Methods //////////////////////////

	// Parse the file header
	private parseHeader(reader: Reader): void {
		reader = reader.reader(reader.u16());
		this.header = reader.bytes(reader.length);
		reader.offset -= reader.length;

		// Content type
		this.contentType = reader.u16();
		console.log(this.contentType);

		if ((this.contentType & 0xff00) == 0x0200) {
			const bits = this.contentType & 0x00ff;
			this.hasMusicEvents = (bits & 0x01) != 0;
			this.hasWaveData = (bits & 0x02) != 0;
			this.hasTextData = (bits & 0x04) != 0;
			this.hasImageData = (bits & 0x08) != 0;
			this.hasFemaleVocals = (bits & 0x10) != 0;
			this.hasMaleVocals = (bits & 0x20) != 0;
			this.hasOtherVocals = (bits & 0x40) != 0;
		}

		// Error checking
		if (this.contentType != 0x0101) {
			throw new Error('Unsupported content type: ' + this.contentType);
		}

		// Number of tracks
		const numTracks = reader.u8();
		if (numTracks > 4) throw new Error('Invalid track count: ' + numTracks);
		this.cuep = new Array<number>(numTracks);
		this.tracks = new Array<Track>(numTracks);

		// Header subchunks
		while (!reader.isEOF()) {
			const id = reader.u32();
			const chunk = reader.reader(reader.u16());
			switch (id) {
				case FOURCC_AINF:
					this.headerAINF(chunk);
					break;
				case FOURCC_AUTH:
					this.headerAUTH(chunk);
					break;
				case FOURCC_COPY:
					this.headerCOPY(chunk);
					break;
				case FOURCC_CUEP:
					this.headerCUEP(chunk);
					break;
				case FOURCC_DATE:
					this.headerDATE(chunk);
					break;
				case FOURCC_EXST:
					this.headerEXST(chunk);
					break;
				case FOURCC_NOTE:
					this.headerNOTE(chunk);
					break;
				case FOURCC_PROT:
					this.headerPROT(chunk);
					break;
				case FOURCC_SORC:
					this.headerSORC(chunk);
					break;
				case FOURCC_SUPT:
					this.headerSUPT(chunk);
					break;
				case FOURCC_THRD:
					this.headerTHRD(chunk);
					break;
				case FOURCC_TITL:
					this.headerTITL(chunk);
					break;
				case FOURCC_VERS:
					this.headerVERS(chunk);
					break;
			}
		}
	}

	// Parse a header "ainf" subchunk
	private headerAINF(reader: Reader) {
		this.ainf = reader.bytes(reader.length);
		if (this.ainf.length > 0)
			this.adpcms = new Array<ADPCM>(this.ainf[0] & 0xff);
	}

	// Parse a header "auth" subchunk
	private headerAUTH(reader: Reader) {
		this.auth = reader.bytes(reader.length);
	}

	// Parse a header "copy" subchunk
	private headerCOPY(reader: Reader) {
		this.copy = this.shiftJIS(reader.bytes(reader.length));
	}

	// Parse a header "cuep" subchunk
	private headerCUEP(reader: Reader) {
		for (let i = 0; i < this.cuep.length; i++) this.cuep[i] = reader.u32();
	}

	// Parse a header "date" subchunk
	private headerDATE(reader: Reader) {
		this.date = this.shiftJIS(reader.bytes(reader.length));
	}

	// Parse a header "exst" subchunk
	private headerEXST(reader: Reader) {
		this.exst = reader.bytes(reader.length);
	}

	// Parse a header "note" subchunk
	private headerNOTE(reader: Reader) {
		this.note = reader.u16();
		if (this.note >> 1 == 0) return;
		throw new Error(`Invalid "note": ${this.note}`);
	}

	// Parse a header "prot" subchunk
	private headerPROT(reader: Reader) {
		this.prot = this.shiftJIS(reader.bytes(reader.length));
	}

	// Parse a header "sorc" subchunk
	private headerSORC(reader: Reader) {
		this.sorc = reader.u8();
	}

	// Parse a header "supt" subchunk
	private headerSUPT(reader: Reader) {
		this.supt = this.shiftJIS(reader.bytes(reader.length));
	}

	// Parse a header "thrd" subchunk
	private headerTHRD(reader: Reader) {
		this.thrd = reader.bytes(reader.length);
	}

	// Parse a header "titl" subchunk
	private headerTITL(reader: Reader) {
		this.titl = this.shiftJIS(reader.bytes(reader.length));
	}

	// Parse a header "vers" subchunk
	private headerVERS(reader: Reader) {
		this.vers = this.shiftJIS(reader.bytes(reader.length));
	}

	////////////////////////// Event Parsing Methods //////////////////////////

	// Parse an event
	private event(note: number, track: number, reader: Reader): Event {
		const event = new Event();

		// Common fields
		event.offset = reader.offset;
		event.delta = reader.u8();
		event.status = reader.u8();

		// Note event
		if ((event.status & 0x3f) != 63)
			return this.eventNote(note, track, event, reader);

		// Meta event fields
		event.id = reader.u8();

		// ext-info event
		if (event.id >= 0xf0) return this.eventExtInfo(event, reader);

		// Unknown event
		if (event.id < 0x80) {
			event.type = EVENT_TYPE_UNKNOWN;
			event.data = reader.bytes(2);
			return event;
		}

		// Common ext-B processing
		event.type = EVENT_TYPE_EXT_B;
		event.param = reader.u8();
		event.channelIndex = event.param >> 6;
		event.channel = (track << 2) | event.channelIndex;

		// timebase-tempo event
		if ((event.id & 0xf0) == EVENT_TIMEBASE_TEMPO)
			return this.eventTimebaseTempo(event);

		// Other event
		switch (event.id) {
			// Events that need further processing
			case EVENT_BANK_CHANGE:
				return this.eventBankChange(event);
			case EVENT_CUEPOINT:
				return this.eventCuepoint(event);
			case EVENT_JUMP:
				return this.eventJump(event);
			case EVENT_MASTER_TUNE:
				return this.eventMasterTune(event);
			case EVENT_MASTER_VOLUME:
				return this.eventMasterVolume(event);
			case EVENT_PANPOT:
				return this.eventPanPot(event);
			case EVENT_PITCHBEND:
				return this.eventPitchBend(event);
			case EVENT_PITCHBEND_RANGE:
				return this.eventPitchBendRange(event);
			case EVENT_PROGRAM_CHANGE:
				return this.eventProgramChange(event);
			case EVENT_VOLUME:
				return this.eventVolume(event);
			case EVENT_X_DRUM_ENABLE:
				return this.eventDrumEnable(event);

			// Events that do not need further processing
			case EVENT_CHANNEL_ASSIGN: // Not implemented
			case EVENT_PART_CONFIGURATION: // Not implemented
			case EVENT_WAVE_CHANNEL_PANPOT: // Not implemented
			case EVENT_WAVE_CHANNEL_VOLUME: // Not implemented
			case EVENT_END_OF_TRACK:
			case EVENT_NOP:
			case EVENT_PAUSE:
			case EVENT_RESET:
			case EVENT_STOP:
				break;

			// Unrecognized events
			default:
		}
		return event;
	}

	// Parse a bank-change event
	private eventBankChange(event: Event) {
		event.bank = event.param & 0x3f;
		return event;
	}

	// Parse a cuepoint event
	private eventCuepoint(event: Event) {
		event.cuepoint = event.param;
		return event;
	}

	// Parse a drum-enable event
	private eventDrumEnable(event: Event) {
		event.channel = (event.param >> 3) & 15;
		event.enable = (event.param & 1) != 0;
		return event;
	}

	// Parse an ext-info event
	private eventExtInfo(event: Event, reader: Reader) {
		event.type = EVENT_TYPE_EXT_INFO;
		event.data = reader.bytes(reader.u16());
		return event;
	}

	// Parse a jump event
	private eventJump(event: Event) {
		event.jumpCount = event.param & 15;
		event.jumpId = (event.param >> 4) & 3;
		event.jumpPoint = event.param >> 6;
		return event;
	}

	// Parse a master-tune event
	private eventMasterTune(event: Event) {
		event.semitones = ((event.param & 0x7f) - 64) / 64.0;
		return event;
	}

	// Parse a master-volume event
	private eventMasterVolume(event: Event) {
		event.volume = this.volumeToAmplitude((event.param & 0x7f) / 127.0);
		return event;
	}

	// Parse a note event
	private eventNote(
		note: number,
		track: number,
		event: Event,
		reader: Reader
	) {
		// Common processing
		event.type = EVENT_TYPE_NOTE;
		event.channelIndex = event.status >> 6;
		event.gateTime = reader.u8();
		event.keyNumber = event.status & 63;

		// Note events are 3 bytes
		if (note == NOTE_3) {
			event.octaveShift = 0;
			event.velocity = 1.0;
		}

		// Note events are 4 bytes
		else {
			const bits = reader.u8();
			event.octaveShift = (bits << 30) >> 30;
			event.velocity = (bits >> 2) / 63.0;
		}

		// Compute normalized fields
		event.channel = (track << 2) | event.channelIndex;
		event.key = event.octaveShift * 12 + event.keyNumber - 24;
		return event;
	}

	// Parse a panpot event
	private eventPanPot(event: Event) {
		const param = event.param & 0x3f;
		event.panpot = param < 32 ? param / 32.0 - 1 : (param - 32) / 31.0;
		return event;
	}

	// Parse a pitchbend event
	private eventPitchBend(event: Event) {
		event.semitones = ((event.param & 0x3f) - 32) / 3200.0;
		return event;
	}

	// Parse a pitchbend-range event
	private eventPitchBendRange(event: Event) {
		event.range = event.param & 0x3f;
		return event;
	}

	// Parse a program-change event
	private eventProgramChange(event: Event) {
		event.program = event.param & 0x3f;
		return event;
	}

	// Parse a timebase-tempo event
	private eventTimebaseTempo(event: Event) {
		event.bank = event.id;
		event.tempo = event.param;
		event.timebase =
			(event.id & 7) == 7
				? -1
				: ((event.id & 15) > 7 ? 15 : 6) << (event.id & 7);
		event.id = EVENT_TIMEBASE_TEMPO;
		return event;
	}

	// Parse a volume event
	private eventVolume(event: Event) {
		event.volume = this.volumeToAmplitude((event.param & 0x3f) / 63.0);
		return event;
	}
}
