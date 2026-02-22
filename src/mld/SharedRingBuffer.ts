type TypedArray =
	| Int8Array
	| Uint8Array
	| Uint8ClampedArray
	| Int16Array
	| Uint16Array
	| Int32Array
	| Uint32Array
	| Float32Array
	| Float64Array
	| BigInt64Array
	| BigUint64Array;

type TypedArrayConstructor<T extends TypedArray> = {
	new (buffer: SharedArrayBuffer, byteOffset: number, length?: number): T;
	BYTES_PER_ELEMENT: number;
};

/**
 * Single producer single consumer ring buffer on SharedArrayBuffer.
 */
export class SharedRingBuffer<T extends TypedArray> {
	private readonly indexes: Int32Array;
	private readonly buffer: T;
	private readonly capacity: number;
	private readonly indexMask: number;

	private static readonly HEADER_SIZE = Int32Array.BYTES_PER_ELEMENT * 2;

	static createBuffer(byteLength: number) {
		if ((byteLength & (byteLength - 1)) !== 0) {
			throw new Error('byteLength must be power of two');
		}

		return new SharedArrayBuffer(byteLength + this.HEADER_SIZE);
	}

	constructor(
		sharedBuffer: SharedArrayBuffer,
		ctor: TypedArrayConstructor<T>
	) {
		this.indexes = new Int32Array(sharedBuffer, 0, 2);
		this.buffer = new ctor(sharedBuffer, SharedRingBuffer.HEADER_SIZE);
		this.capacity = this.buffer.length;

		if ((this.capacity & (this.capacity - 1)) !== 0) {
			throw new Error('bufferSize must be power of two + header size');
		}

		this.indexMask = this.capacity - 1;
	}

	getCapacity() {
		return this.capacity;
	}

	getReadIndex() {
		return Atomics.load(this.indexes, 0);
	}

	getWriteIndex() {
		return Atomics.load(this.indexes, 1);
	}

	getDataView() {
		return this.buffer;
	}

	availableReadSize() {
		const readIndex = this.getReadIndex();
		const writeIndex = this.getWriteIndex();
		return (writeIndex - readIndex) | 0; // JS trick to get 32 bit overflow
	}

	availableWriteSize() {
		return this.capacity - this.availableReadSize();
	}

	write(src: T, offset = 0, size = src.length - offset) {
		if (offset < 0 || size < 0 || offset + size > src.length) {
			throw new RangeError('write out of bounds');
		}

		const readIndex = this.getReadIndex();
		const writeIndex = this.getWriteIndex();

		const used = (writeIndex - readIndex) | 0;
		const free = this.capacity - used;

		const toWrite = Math.min(size, free);
		if (toWrite <= 0) return 0;

		const start = writeIndex & this.indexMask;
		const firstSize = Math.min(toWrite, this.capacity - start);

		this.buffer.set(
			src.subarray(offset, offset + firstSize) as never,
			start
		);

		if (firstSize < toWrite) {
			this.buffer.set(
				src.subarray(offset + firstSize, offset + toWrite) as never,
				0
			);
		}

		Atomics.store(this.indexes, 1, (writeIndex + toWrite) | 0);
		return toWrite;
	}

	read(out: T, offset = 0, size = out.length - offset) {
		if (offset < 0 || size < 0 || offset + size > out.length) {
			throw new RangeError('read out of bounds');
		}

		const readIndex = this.getReadIndex();
		const writeIndex = this.getWriteIndex();

		const used = (writeIndex - readIndex) | 0;
		const toRead = Math.min(size, used);
		if (toRead <= 0) return 0;

		const start = readIndex & this.indexMask;
		const firstSize = Math.min(toRead, this.capacity - start);

		out.set(
			this.buffer.subarray(start, start + firstSize) as never,
			offset
		);

		if (firstSize < toRead) {
			out.set(
				this.buffer.subarray(0, toRead - firstSize) as never,
				offset + firstSize
			);
		}

		Atomics.store(this.indexes, 0, (readIndex + toRead) | 0);
		return toRead;
	}
}
