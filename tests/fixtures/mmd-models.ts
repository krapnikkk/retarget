// Minimal hand-built PMX 2.0 and PMD models: one triangle, two bones.

export function createMinimalPMXAvatar(texturePath?: string) {
  const writer = new BinaryWriter();
  writer.writeAscii("PMX ");
  writer.writeFloat32(2);
  writer.writeUint8(8);
  [1, 0, 4, 4, 4, 4, 4, 4].forEach((value) => writer.writeUint8(value));
  writer.writeText("PMX Test");
  writer.writeText("PMX Test");
  writer.writeText("");
  writer.writeText("");

  writer.writeInt32(3);
  writePMXVertex(writer, [0, 0, 0], [0, 1, 0], [0, 0], 0);
  writePMXVertex(writer, [1, 0, 0], [0, 1, 0], [1, 0], 1);
  writePMXVertex(writer, [0, 1, 0], [0, 1, 0], [0, 1], 1);

  writer.writeInt32(3);
  [0, 1, 2].forEach((index) => writer.writeUint32(index));

  writer.writeInt32(texturePath ? 1 : 0);
  if (texturePath) {
    writer.writeText(texturePath);
  }
  writer.writeInt32(1);
  writer.writeText("PMX Material");
  writer.writeText("PMX Material");
  [1, 0.8, 0.8, 1].forEach((value) => writer.writeFloat32(value));
  [0, 0, 0].forEach((value) => writer.writeFloat32(value));
  writer.writeFloat32(0);
  [0.5, 0.5, 0.5].forEach((value) => writer.writeFloat32(value));
  writer.writeUint8(0);
  [0, 0, 0, 1].forEach((value) => writer.writeFloat32(value));
  writer.writeFloat32(1);
  writer.writeInt32(texturePath ? 0 : -1);
  writer.writeInt32(-1);
  writer.writeUint8(0);
  writer.writeUint8(1);
  writer.writeUint8(0);
  writer.writeText("");
  writer.writeInt32(3);

  writer.writeInt32(2);
  writePMXBone(writer, "センター", [0, 0, 0], -1, [0, 1, 0]);
  writePMXBone(writer, "左腕", [-1, 1, 0], 0, [-0.5, 0, 0]);

  writer.writeInt32(0); // morphs
  writer.writeInt32(0); // display frames
  writer.writeInt32(0); // rigid bodies
  writer.writeInt32(0); // joints

  return writer.toUint8Array();
}

function writePMXVertex(
  writer: BinaryWriter,
  position: [number, number, number],
  normal: [number, number, number],
  uv: [number, number],
  boneIndex: number,
) {
  position.forEach((value) => writer.writeFloat32(value));
  normal.forEach((value) => writer.writeFloat32(value));
  uv.forEach((value) => writer.writeFloat32(value));
  writer.writeUint8(0);
  writer.writeInt32(boneIndex);
  writer.writeFloat32(1);
}

function writePMXBone(
  writer: BinaryWriter,
  name: string,
  position: [number, number, number],
  parentIndex: number,
  tailOffset: [number, number, number],
) {
  writer.writeText(name);
  writer.writeText(name);
  position.forEach((value) => writer.writeFloat32(value));
  writer.writeInt32(parentIndex);
  writer.writeInt32(0);
  writer.writeUint16(0);
  tailOffset.forEach((value) => writer.writeFloat32(value));
}

export function createMinimalPMDAvatar() {
  const writer = new BinaryWriter();
  writer.writeAscii("Pmd");
  writer.writeFloat32(1);
  writer.writeFixedAscii("PMD Test", 20);
  writer.writeFixedAscii("minimal PMD avatar", 256);

  writer.writeInt32(3);
  writePMDVertex(writer, [0, 0, 0], [0, 1, 0], [0, 0], 0, 1);
  writePMDVertex(writer, [1, 0, 0], [0, 1, 0], [1, 0], 1, 0);
  writePMDVertex(writer, [0, 1, 0], [0, 1, 0], [0, 1], 1, 0);

  writer.writeInt32(3);
  [0, 1, 2].forEach((index) => writer.writeUint16(index));

  writer.writeInt32(1);
  [0.7, 0.7, 1, 1].forEach((value) => writer.writeFloat32(value));
  writer.writeFloat32(0);
  [0, 0, 0].forEach((value) => writer.writeFloat32(value));
  [0.5, 0.5, 0.5].forEach((value) => writer.writeFloat32(value));
  writer.writeUint8(0);
  writer.writeUint8(0);
  writer.writeUint32(3);
  writer.writeFixedAscii("", 20);

  writer.writeUint16(2);
  writePMDBone(writer, "hips", 0xffff, 1, [0, 0, 0]);
  writePMDBone(writer, "leftUpperArm", 0, 0, [-1, 1, 0]);

  return writer.toUint8Array();
}

function writePMDVertex(
  writer: BinaryWriter,
  position: [number, number, number],
  normal: [number, number, number],
  uv: [number, number],
  bone0: number,
  bone1: number,
) {
  position.forEach((value) => writer.writeFloat32(value));
  normal.forEach((value) => writer.writeFloat32(value));
  uv.forEach((value) => writer.writeFloat32(value));
  writer.writeUint16(bone0);
  writer.writeUint16(bone1);
  writer.writeUint8(100);
  writer.writeUint8(0);
}

function writePMDBone(
  writer: BinaryWriter,
  name: string,
  parentIndex: number,
  tailIndex: number,
  position: [number, number, number],
) {
  writer.writeFixedAscii(name, 20);
  writer.writeUint16(parentIndex);
  writer.writeUint16(tailIndex);
  writer.writeUint8(0);
  writer.writeUint16(0);
  position.forEach((value) => writer.writeFloat32(value));
}

export class BinaryWriter {
  private bytes: number[] = [];
  private textEncoder = new TextEncoder();

  writeAscii(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      this.writeUint8(value.charCodeAt(index));
    }
  }

  writeFixedAscii(value: string, length: number) {
    const encoded = this.textEncoder.encode(value).slice(0, length);
    this.writeBytes(encoded);
    for (let index = encoded.length; index < length; index += 1) {
      this.writeUint8(0);
    }
  }

  writeText(value: string) {
    const encoded = this.textEncoder.encode(value);
    this.writeInt32(encoded.length);
    this.writeBytes(encoded);
  }

  writeBytes(value: Uint8Array) {
    this.bytes.push(...value);
  }

  writeUint8(value: number) {
    this.bytes.push(value & 0xff);
  }

  writeUint16(value: number) {
    this.writeDataView(2, (view) => view.setUint16(0, value, true));
  }

  writeInt32(value: number) {
    this.writeDataView(4, (view) => view.setInt32(0, value, true));
  }

  writeUint32(value: number) {
    this.writeDataView(4, (view) => view.setUint32(0, value, true));
  }

  writeFloat32(value: number) {
    this.writeDataView(4, (view) => view.setFloat32(0, value, true));
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }

  private writeDataView(length: number, write: (view: DataView) => void) {
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    write(view);
    this.writeBytes(new Uint8Array(buffer));
  }
}
