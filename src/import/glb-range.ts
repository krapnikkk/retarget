import { readBlobArrayBufferWithSignal } from "@/browser/read-file";

const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const GLB_MAGIC = 0x46546c67;

export type GLBRangeInfo = {
  json: Record<string, unknown>;
  declaredByteLength: number;
  binaryChunk: { offset: number; byteLength: number } | null;
};

export type GLTFRigMetadata = {
  json: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  skins: Array<Record<string, unknown>>;
  animations: Array<Record<string, unknown>>;
};

export async function readGLBRangeInfo(
  blob: Blob,
  signal?: AbortSignal,
): Promise<GLBRangeInfo> {
  const { declaredByteLength, jsonBytes, nextChunkOffset } =
    await readGLBJSONChunk(blob, signal);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<
      string,
      unknown
    >;
  } catch (cause) {
    throw new Error("GLB JSON chunk could not be parsed.", { cause });
  }

  let binaryChunk: GLBRangeInfo["binaryChunk"] = null;
  if (nextChunkOffset + CHUNK_HEADER_BYTES <= declaredByteLength) {
    const chunkHeader = await readBlobRange(
      blob,
      nextChunkOffset,
      CHUNK_HEADER_BYTES,
      signal,
    );
    const chunkView = new DataView(
      chunkHeader.buffer,
      chunkHeader.byteOffset,
      chunkHeader.byteLength,
    );
    const byteLength = chunkView.getUint32(0, true);
    const type = chunkView.getUint32(4, true);
    const offset = nextChunkOffset + CHUNK_HEADER_BYTES;
    if (offset + byteLength > declaredByteLength) {
      throw new Error("GLB binary chunk is outside the declared file length.");
    }
    if (type === BIN_CHUNK_TYPE) {
      binaryChunk = { offset, byteLength };
    }
  }
  return { json, declaredByteLength, binaryChunk };
}

export async function readGLBStructuralJSONBytes(
  blob: Blob,
  signal?: AbortSignal,
) {
  const { jsonBytes } = await readGLBJSONChunk(blob, signal);
  return jsonBytes.slice().buffer;
}

async function readGLBJSONChunk(blob: Blob, signal?: AbortSignal) {
  const header = await readBlobRange(
    blob,
    0,
    GLB_HEADER_BYTES + CHUNK_HEADER_BYTES,
    signal,
  );
  if (header.byteLength < GLB_HEADER_BYTES + CHUNK_HEADER_BYTES) {
    throw new Error("GLB header is truncated.");
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error("GLB header is invalid.");
  }
  const declaredByteLength = view.getUint32(8, true);
  if (declaredByteLength > blob.size || declaredByteLength < header.byteLength) {
    throw new Error("GLB declared byte length is invalid.");
  }
  const jsonByteLength = view.getUint32(GLB_HEADER_BYTES, true);
  const jsonType = view.getUint32(GLB_HEADER_BYTES + 4, true);
  if (
    jsonType !== JSON_CHUNK_TYPE ||
    jsonByteLength <= 0 ||
    GLB_HEADER_BYTES + CHUNK_HEADER_BYTES + jsonByteLength > declaredByteLength
  ) {
    throw new Error("GLB JSON chunk is invalid.");
  }
  const jsonBytes = await readBlobRange(
    blob,
    GLB_HEADER_BYTES + CHUNK_HEADER_BYTES,
    jsonByteLength,
    signal,
  );
  const nextChunkOffset = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES + jsonByteLength;
  return { declaredByteLength, jsonBytes, nextChunkOffset };
}

export async function readBlobRange(
  blob: Blob,
  offset: number,
  byteLength: number,
  signal?: AbortSignal,
) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(byteLength) ||
    offset < 0 ||
    byteLength < 0 ||
    offset + byteLength > blob.size
  ) {
    throw new RangeError("Blob byte range is outside the source.");
  }
  return new Uint8Array(
    await readBlobArrayBufferWithSignal(
      blob.slice(offset, offset + byteLength),
      `glb-range:${offset}+${byteLength}`,
      signal,
      byteLength,
    ),
  );
}

export async function readGLTFRigMetadata(
  blob: Blob,
  signal?: AbortSignal,
): Promise<GLTFRigMetadata> {
  const { json } = await readGLBRangeInfo(blob, signal);
  return {
    json,
    nodes: Array.isArray(json.nodes)
      ? json.nodes as Array<Record<string, unknown>>
      : [],
    skins: Array.isArray(json.skins)
      ? json.skins as Array<Record<string, unknown>>
      : [],
    animations: Array.isArray(json.animations)
      ? json.animations as Array<Record<string, unknown>>
      : [],
  };
}
