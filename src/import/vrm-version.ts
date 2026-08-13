export type VRMVersion = "0.x" | "1.0" | "unknown";

const GLB_HEADER_BYTES = 20;
const MAX_TEXT_GLTF_BYTES = 64 * 1024 * 1024;

export async function detectVRMVersionFromFile(file: Blob): Promise<VRMVersion> {
  const prefix = new Uint8Array(
    await file.slice(0, Math.min(GLB_HEADER_BYTES, file.size)).arrayBuffer(),
  );
  if (new TextDecoder().decode(prefix).trimStart().startsWith("{")) {
    if (file.size > MAX_TEXT_GLTF_BYTES) {
      return "unknown";
    }
    return detectVRMVersion(new Uint8Array(await file.arrayBuffer()));
  }
  if (prefix.byteLength < GLB_HEADER_BYTES) {
    return "unknown";
  }
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(16, true) !== 0x4e4f534a
  ) {
    return "unknown";
  }
  const jsonLength = view.getUint32(12, true);
  if (jsonLength <= 0 || GLB_HEADER_BYTES + jsonLength > file.size) {
    return "unknown";
  }
  const jsonChunk = new Uint8Array(
    await file.slice(GLB_HEADER_BYTES, GLB_HEADER_BYTES + jsonLength).arrayBuffer(),
  );
  return detectVRMVersionFromJSONBytes(jsonChunk);
}

export function detectVRMVersion(bytes: Uint8Array): VRMVersion {
  const json = readGLTFJson(bytes);
  if (!json) {
    return "unknown";
  }
  const extensions = json.extensions;
  if (!extensions || typeof extensions !== "object") {
    return "unknown";
  }
  if ("VRMC_vrm" in extensions) {
    return "1.0";
  }
  if ("VRM" in extensions) {
    return "0.x";
  }
  return "unknown";
}

function detectVRMVersionFromJSONBytes(bytes: Uint8Array): VRMVersion {
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    const extensions = json.extensions;
    if (!extensions || typeof extensions !== "object") return "unknown";
    if ("VRMC_vrm" in extensions) return "1.0";
    if ("VRM" in extensions) return "0.x";
  } catch {
    return "unknown";
  }
  return "unknown";
}

function readGLTFJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    if (new TextDecoder().decode(bytes.slice(0, 16)).trimStart().startsWith("{")) {
      return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    }
    if (bytes.byteLength < 20) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
      return null;
    }
    const jsonLength = view.getUint32(12, true);
    const jsonType = view.getUint32(16, true);
    if (jsonType !== 0x4e4f534a || 20 + jsonLength > bytes.byteLength) {
      return null;
    }
    return JSON.parse(
      new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}
