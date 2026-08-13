const INITIAL_CAPACITY = 4096;

export class GrowableBuffer {
  private buffer: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  private pos = 0;

  constructor(initialCapacity = INITIAL_CAPACITY) {
    this.buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  get offset() {
    return this.pos;
  }

  writeUint8(value: number) {
    this.ensureCapacity(1);
    this.view.setUint8(this.pos, value);
    this.pos += 1;
  }

  writeInt8(value: number) {
    this.ensureCapacity(1);
    this.view.setInt8(this.pos, value);
    this.pos += 1;
  }

  writeUint16(value: number) {
    this.ensureCapacity(2);
    this.view.setUint16(this.pos, value, true);
    this.pos += 2;
  }

  writeInt16(value: number) {
    this.ensureCapacity(2);
    this.view.setInt16(this.pos, value, true);
    this.pos += 2;
  }

  writeUint32(value: number) {
    this.ensureCapacity(4);
    this.view.setUint32(this.pos, value, true);
    this.pos += 4;
  }

  writeInt32(value: number) {
    this.ensureCapacity(4);
    this.view.setInt32(this.pos, value, true);
    this.pos += 4;
  }

  writeFloat32(value: number) {
    this.ensureCapacity(4);
    this.view.setFloat32(this.pos, value, true);
    this.pos += 4;
  }

  writeFloat64(value: number) {
    this.ensureCapacity(8);
    this.view.setFloat64(this.pos, value, true);
    this.pos += 8;
  }

  writeInt64(value: number) {
    this.ensureCapacity(8);
    this.view.setBigInt64(this.pos, BigInt(value), true);
    this.pos += 8;
  }

  writeBytes(value: Uint8Array) {
    this.ensureCapacity(value.length);
    this.bytes.set(value, this.pos);
    this.pos += value.length;
  }

  writeAscii(value: string) {
    this.ensureCapacity(value.length);
    for (let i = 0; i < value.length; i += 1) {
      this.bytes[this.pos + i] = value.charCodeAt(i);
    }
    this.pos += value.length;
  }

  patchUint32(offset: number, value: number) {
    this.view.setUint32(offset, value, true);
  }

  toUint8Array() {
    return new Uint8Array(this.buffer, 0, this.pos);
  }

  private ensureCapacity(needed: number) {
    const required = this.pos + needed;
    if (required <= this.buffer.byteLength) {
      return;
    }
    let newCapacity = this.buffer.byteLength;
    while (newCapacity < required) {
      newCapacity *= 2;
    }
    const newBuffer = new ArrayBuffer(newCapacity);
    new Uint8Array(newBuffer).set(this.bytes.subarray(0, this.pos));
    this.buffer = newBuffer;
    this.view = new DataView(newBuffer);
    this.bytes = new Uint8Array(newBuffer);
  }
}
