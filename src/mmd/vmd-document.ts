import { VmdObject } from "@moeru/three-mmd";

export const VMD_FPS = 30;

export type VMDBoneFrame = {
  boneName: string;
  boneNameBytes?: Uint8Array;
  frameNumber: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
  interpolation: Uint8Array;
};

export type VMDMorphFrame = {
  morphName: string;
  morphNameBytes?: Uint8Array;
  frameNumber: number;
  weight: number;
};

export type VMDCameraFrame = {
  frameNumber: number;
  distance: number;
  position: [number, number, number];
  rotation: [number, number, number];
  interpolation: Uint8Array;
  fov: number;
  perspective: boolean;
};

export type VMDLightFrame = {
  frameNumber: number;
  color: [number, number, number];
  direction: [number, number, number];
};

export type VMDSelfShadowFrame = {
  frameNumber: number;
  mode: number;
  distance: number;
};

export type VMDPropertyFrame = {
  frameNumber: number;
  visible: boolean;
  ikStates: Array<{
    name: string;
    nameBytes?: Uint8Array;
    enabled: boolean;
  }>;
};

export type VMDDocument = {
  signature: string;
  signatureBytes?: Uint8Array;
  modelName: string;
  modelNameBytes?: Uint8Array;
  boneFrames: VMDBoneFrame[];
  morphFrames: VMDMorphFrame[];
  cameraFrames: VMDCameraFrame[];
  lightFrames: VMDLightFrame[];
  selfShadowFrames: VMDSelfShadowFrame[];
  propertyFrames: VMDPropertyFrame[];
  maxFrame: number;
  duration: number;
};

const SIGNATURE_BYTES = 30;
const MODEL_NAME_BYTES = 20;
const BONE_FRAME_BYTES = 111;
const MORPH_FRAME_BYTES = 23;
const CAMERA_FRAME_BYTES = 61;
const LIGHT_FRAME_BYTES = 28;
const SELF_SHADOW_FRAME_BYTES = 9;
const MAX_VMD_DOCUMENT_BYTES = 100 * 1024 * 1024;
const MAX_VMD_SECTION_FRAMES = 2_000_000;

export function parseVMDDocument(bytes: Uint8Array): VMDDocument {
  preflightVMDDocument(bytes);
  let vmd: VmdObject;
  try {
    vmd = VmdObject.ParseFromBuffer(toArrayBuffer(bytes));
  } catch (error) {
    throw new Error(
      `VMD document is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const signatureBytes = bytes.slice(0, SIGNATURE_BYTES);
  const modelNameBytes = bytes.slice(
    SIGNATURE_BYTES,
    SIGNATURE_BYTES + MODEL_NAME_BYTES,
  );
  let offset = SIGNATURE_BYTES + MODEL_NAME_BYTES + 4;
  const boneFrames = readFrames(vmd.boneKeyFrames, (frame, index) => ({
    boneName: frame.boneName,
    boneNameBytes: bytes.slice(
      offset + index * BONE_FRAME_BYTES,
      offset + index * BONE_FRAME_BYTES + 15,
    ),
    frameNumber: frame.frameNumber,
    position: [...frame.position] as [number, number, number],
    rotation: [...frame.rotation] as [number, number, number, number],
    interpolation: frame.interpolation.slice(),
  }));
  offset += boneFrames.length * BONE_FRAME_BYTES + 4;

  const morphFrames = readFrames(vmd.morphKeyFrames, (frame, index) => ({
    morphName: frame.morphName,
    morphNameBytes: bytes.slice(
      offset + index * MORPH_FRAME_BYTES,
      offset + index * MORPH_FRAME_BYTES + 15,
    ),
    frameNumber: frame.frameNumber,
    weight: frame.weight,
  }));
  offset += morphFrames.length * MORPH_FRAME_BYTES + 4;

  const cameraFrames = readFrames(vmd.cameraKeyFrames, (frame) => ({
    frameNumber: frame.frameNumber,
    distance: frame.distance,
    position: [...frame.position] as [number, number, number],
    rotation: [...frame.rotation] as [number, number, number],
    interpolation: frame.interpolation.slice(),
    fov: frame.fov,
    perspective: frame.perspective,
  }));
  offset += cameraFrames.length * CAMERA_FRAME_BYTES + 4;

  const lightFrames = readFrames(vmd.lightKeyFrames, (frame) => ({
    frameNumber: frame.frameNumber,
    color: [...frame.color] as [number, number, number],
    direction: [...frame.direction] as [number, number, number],
  }));
  offset += lightFrames.length * LIGHT_FRAME_BYTES + 4;

  const selfShadowFrames = readFrames(vmd.selfShadowKeyFrames, (frame) => ({
    frameNumber: frame.frameNumber,
    mode: frame.mode,
    distance: frame.distance,
  }));
  offset += selfShadowFrames.length * SELF_SHADOW_FRAME_BYTES + 4;

  const propertyFrames = vmd.propertyKeyFrames.map((frame) => {
    offset += 9;
    const ikStates = frame.ikStates.map(([name, enabled]) => {
      const nameBytes = bytes.slice(offset, offset + 20);
      offset += 21;
      return { name, nameBytes, enabled };
    });
    return {
      frameNumber: frame.frameNumber,
      visible: frame.visible,
      ikStates,
    };
  });

  const maxFrame = Math.max(
    0,
    ...boneFrames.map((frame) => frame.frameNumber),
    ...morphFrames.map((frame) => frame.frameNumber),
    ...cameraFrames.map((frame) => frame.frameNumber),
    ...lightFrames.map((frame) => frame.frameNumber),
    ...selfShadowFrames.map((frame) => frame.frameNumber),
    ...propertyFrames.map((frame) => frame.frameNumber),
  );

  return {
    signature: decodeVMDString(signatureBytes),
    signatureBytes,
    modelName: decodeVMDString(modelNameBytes),
    modelNameBytes,
    boneFrames,
    morphFrames,
    cameraFrames,
    lightFrames,
    selfShadowFrames,
    propertyFrames,
    maxFrame,
    duration: maxFrame / VMD_FPS,
  };
}

function preflightVMDDocument(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_VMD_DOCUMENT_BYTES) {
    throw new Error(
      `VMD document exceeds the ${MAX_VMD_DOCUMENT_BYTES}-byte safe limit.`,
    );
  }
  if (bytes.byteLength < SIGNATURE_BYTES + MODEL_NAME_BYTES + 4) {
    throw new Error("VMD document is too small.");
  }
  const signature = decodeVMDString(bytes.slice(0, SIGNATURE_BYTES));
  if (!signature.includes("Vocaloid Motion Data")) {
    throw new Error("VMD signature is invalid.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = SIGNATURE_BYTES + MODEL_NAME_BYTES;
  let totalFrames = 0;
  for (const [label, recordBytes] of [
    ["bone", BONE_FRAME_BYTES],
    ["morph", MORPH_FRAME_BYTES],
    ["camera", CAMERA_FRAME_BYTES],
    ["light", LIGHT_FRAME_BYTES],
    ["self-shadow", SELF_SHADOW_FRAME_BYTES],
  ] as const) {
    ensureVMDRange(bytes, offset, 4, `${label} count`);
    const count = view.getUint32(offset, true);
    totalFrames += count;
    if (count > MAX_VMD_SECTION_FRAMES || totalFrames > MAX_VMD_SECTION_FRAMES) {
      throw new Error(`VMD ${label} frame count exceeds the safe limit.`);
    }
    offset += 4;
    const sectionBytes = count * recordBytes;
    ensureVMDRange(bytes, offset, sectionBytes, `${label} frames`);
    offset += sectionBytes;
  }
  ensureVMDRange(bytes, offset, 4, "property count");
  const propertyCount = view.getUint32(offset, true);
  totalFrames += propertyCount;
  if (
    propertyCount > MAX_VMD_SECTION_FRAMES ||
    totalFrames > MAX_VMD_SECTION_FRAMES
  ) {
    throw new Error("VMD property frame count exceeds the safe limit.");
  }
  offset += 4;
  for (let frame = 0; frame < propertyCount; frame += 1) {
    ensureVMDRange(bytes, offset, 9, "property frame");
    const ikStateCount = view.getUint32(offset + 5, true);
    offset += 9;
    ensureVMDRange(bytes, offset, ikStateCount * 21, "property IK states");
    offset += ikStateCount * 21;
  }
  if (offset !== bytes.byteLength) {
    throw new Error(`VMD document has ${bytes.byteLength - offset} unexpected trailing bytes.`);
  }
}

function ensureVMDRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
) {
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset < 0 ||
    offset + length > bytes.byteLength
  ) {
    throw new Error(`VMD document is truncated while reading ${label}.`);
  }
}

export function serializeVMDDocument(document: VMDDocument) {
  validateDocument(document);
  const writer = new VMDWriter();
  writer.writeFixedString(
    document.signature || "Vocaloid Motion Data 0002",
    SIGNATURE_BYTES,
    document.signatureBytes,
  );
  writer.writeFixedString(document.modelName, MODEL_NAME_BYTES, document.modelNameBytes);
  writer.writeUint32(document.boneFrames.length);
  for (const frame of document.boneFrames) {
    writer.writeFixedString(frame.boneName, 15, frame.boneNameBytes);
    writer.writeUint32(frame.frameNumber);
    writer.writeFloatTuple(frame.position);
    writer.writeFloatTuple(frame.rotation);
    writer.writeBytes(frame.interpolation);
  }
  writer.writeUint32(document.morphFrames.length);
  for (const frame of document.morphFrames) {
    writer.writeFixedString(frame.morphName, 15, frame.morphNameBytes);
    writer.writeUint32(frame.frameNumber);
    writer.writeFloat32(frame.weight);
  }
  writer.writeUint32(document.cameraFrames.length);
  for (const frame of document.cameraFrames) {
    writer.writeUint32(frame.frameNumber);
    writer.writeFloat32(frame.distance);
    writer.writeFloatTuple(frame.position);
    writer.writeFloatTuple(frame.rotation);
    writer.writeBytes(frame.interpolation);
    writer.writeUint32(frame.fov);
    writer.writeUint8(frame.perspective ? 1 : 0);
  }
  writer.writeUint32(document.lightFrames.length);
  for (const frame of document.lightFrames) {
    writer.writeUint32(frame.frameNumber);
    writer.writeFloatTuple(frame.color);
    writer.writeFloatTuple(frame.direction);
  }
  writer.writeUint32(document.selfShadowFrames.length);
  for (const frame of document.selfShadowFrames) {
    writer.writeUint32(frame.frameNumber);
    writer.writeUint8(frame.mode);
    writer.writeFloat32(frame.distance);
  }
  writer.writeUint32(document.propertyFrames.length);
  for (const frame of document.propertyFrames) {
    writer.writeUint32(frame.frameNumber);
    writer.writeUint8(frame.visible ? 1 : 0);
    writer.writeUint32(frame.ikStates.length);
    for (const state of frame.ikStates) {
      writer.writeFixedString(state.name, 20, state.nameBytes);
      writer.writeUint8(state.enabled ? 1 : 0);
    }
  }
  return writer.toUint8Array();
}

export function createLinearVMDBoneInterpolation() {
  return new Uint8Array([
    20, 20, 0, 0, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107,
    20, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 0,
    20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 0, 0,
    20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 0, 0, 0,
  ]);
}

export function decodeVMDString(bytes: Uint8Array) {
  const end = bytes.indexOf(0);
  const value = end >= 0 ? bytes.slice(0, end) : bytes;
  try {
    return new TextDecoder("shift-jis").decode(value);
  } catch {
    return new TextDecoder().decode(value);
  }
}

function readFrames<TSource, TResult>(
  reader: { length: number; get(index: number): TSource },
  map: (frame: TSource, index: number) => TResult,
) {
  return Array.from({ length: reader.length }, (_, index) => map(reader.get(index), index));
}

function validateDocument(document: VMDDocument) {
  if (!document.signature.includes("Vocaloid Motion Data")) {
    throw new Error("VMD signature is invalid.");
  }
  for (const frame of document.boneFrames) {
    validateFrameNumber(frame.frameNumber);
    validateFiniteTuple(frame.position, "bone position");
    validateFiniteTuple(frame.rotation, "bone rotation");
    if (frame.interpolation.length !== 64) {
      throw new Error("VMD bone interpolation must contain 64 bytes.");
    }
  }
  for (const frame of document.morphFrames) {
    validateFrameNumber(frame.frameNumber);
    validateFiniteTuple([frame.weight], "morph weight");
  }
  for (const frame of document.cameraFrames) {
    validateFrameNumber(frame.frameNumber);
    validateFiniteTuple(
      [frame.distance, ...frame.position, ...frame.rotation],
      "camera values",
    );
    if (frame.interpolation.length !== 24) {
      throw new Error("VMD camera interpolation must contain 24 bytes.");
    }
  }
  for (const frame of document.lightFrames) {
    validateFrameNumber(frame.frameNumber);
    validateFiniteTuple([...frame.color, ...frame.direction], "light values");
  }
  for (const frame of document.selfShadowFrames) {
    validateFrameNumber(frame.frameNumber);
    validateFiniteTuple([frame.distance], "self-shadow distance");
  }
  for (const frame of document.propertyFrames) {
    validateFrameNumber(frame.frameNumber);
  }
}

function validateFrameNumber(frameNumber: number) {
  if (!Number.isInteger(frameNumber) || frameNumber < 0 || frameNumber > 0xffffffff) {
    throw new Error(`Invalid VMD frame number: ${frameNumber}.`);
  }
}

function validateFiniteTuple(values: readonly number[], label: string) {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`VMD ${label} must contain finite numbers.`);
  }
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

class VMDWriter {
  private readonly bytes: number[] = [];

  writeBytes(value: Uint8Array) {
    this.bytes.push(...value);
  }

  writeFixedString(value: string, length: number, original?: Uint8Array) {
    const encoded =
      original && decodeVMDString(original) === value
        ? original.slice(0, length)
        : encodeVMDString(value).slice(0, length);
    this.writeBytes(encoded);
    for (let index = encoded.length; index < length; index += 1) {
      this.writeUint8(0);
    }
  }

  writeFloatTuple(value: readonly number[]) {
    for (const item of value) {
      this.writeFloat32(item);
    }
  }

  writeUint8(value: number) {
    this.bytes.push(value & 0xff);
  }

  writeUint32(value: number) {
    this.writeNumber(4, (view) => view.setUint32(0, value, true));
  }

  writeFloat32(value: number) {
    this.writeNumber(4, (view) => view.setFloat32(0, value, true));
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }

  private writeNumber(length: number, write: (view: DataView) => void) {
    const buffer = new ArrayBuffer(length);
    write(new DataView(buffer));
    this.writeBytes(new Uint8Array(buffer));
  }
}

function encodeVMDString(value: string) {
  const mapped = SHIFT_JIS_BYTES[value];
  if (mapped) {
    return new Uint8Array(mapped);
  }
  const ascii = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    ascii[index] = code <= 0x7f ? code : 0x3f;
  }
  return ascii;
}

const SHIFT_JIS_BYTES: Readonly<Record<string, readonly number[]>> = {
  "センター": [131, 90, 131, 147, 131, 94, 129, 91],
  "上半身": [143, 227, 148, 188, 144, 103],
  "上半身2": [143, 227, 148, 188, 144, 103, 50],
  "上半身3": [143, 227, 148, 188, 144, 103, 51],
  "首": [142, 241],
  "頭": [147, 170],
  "左肩": [141, 182, 140, 168],
  "左腕": [141, 182, 152, 114],
  "左ひじ": [141, 182, 130, 208, 130, 182],
  "左手首": [141, 182, 142, 232, 142, 241],
  "左親指０": [141, 182, 144, 101, 142, 119, 130, 79],
  "左親指１": [141, 182, 144, 101, 142, 119, 130, 80],
  "左親指２": [141, 182, 144, 101, 142, 119, 130, 81],
  "左人指１": [141, 182, 144, 108, 142, 119, 130, 80],
  "左人指２": [141, 182, 144, 108, 142, 119, 130, 81],
  "左人指３": [141, 182, 144, 108, 142, 119, 130, 82],
  "左中指１": [141, 182, 146, 134, 142, 119, 130, 80],
  "左中指２": [141, 182, 146, 134, 142, 119, 130, 81],
  "左中指３": [141, 182, 146, 134, 142, 119, 130, 82],
  "左薬指１": [141, 182, 150, 242, 142, 119, 130, 80],
  "左薬指２": [141, 182, 150, 242, 142, 119, 130, 81],
  "左薬指３": [141, 182, 150, 242, 142, 119, 130, 82],
  "左小指１": [141, 182, 143, 172, 142, 119, 130, 80],
  "左小指２": [141, 182, 143, 172, 142, 119, 130, 81],
  "左小指３": [141, 182, 143, 172, 142, 119, 130, 82],
  "右肩": [137, 69, 140, 168],
  "右腕": [137, 69, 152, 114],
  "右ひじ": [137, 69, 130, 208, 130, 182],
  "右手首": [137, 69, 142, 232, 142, 241],
  "右親指０": [137, 69, 144, 101, 142, 119, 130, 79],
  "右親指１": [137, 69, 144, 101, 142, 119, 130, 80],
  "右親指２": [137, 69, 144, 101, 142, 119, 130, 81],
  "右人指１": [137, 69, 144, 108, 142, 119, 130, 80],
  "右人指２": [137, 69, 144, 108, 142, 119, 130, 81],
  "右人指３": [137, 69, 144, 108, 142, 119, 130, 82],
  "右中指１": [137, 69, 146, 134, 142, 119, 130, 80],
  "右中指２": [137, 69, 146, 134, 142, 119, 130, 81],
  "右中指３": [137, 69, 146, 134, 142, 119, 130, 82],
  "右薬指１": [137, 69, 150, 242, 142, 119, 130, 80],
  "右薬指２": [137, 69, 150, 242, 142, 119, 130, 81],
  "右薬指３": [137, 69, 150, 242, 142, 119, 130, 82],
  "右小指１": [137, 69, 143, 172, 142, 119, 130, 80],
  "右小指２": [137, 69, 143, 172, 142, 119, 130, 81],
  "右小指３": [137, 69, 143, 172, 142, 119, 130, 82],
  "左足": [141, 182, 145, 171],
  "左ひざ": [141, 182, 130, 208, 130, 180],
  "左足首": [141, 182, 145, 171, 142, 241],
  "左つま先": [141, 182, 130, 194, 130, 220, 144, 230],
  "右足": [137, 69, 145, 171],
  "右ひざ": [137, 69, 130, 208, 130, 180],
  "右足首": [137, 69, 145, 171, 142, 241],
  "右つま先": [137, 69, 130, 194, 130, 220, 144, 230],
};
