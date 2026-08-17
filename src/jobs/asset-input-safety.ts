import { RetargetError } from "@/retarget/errors";

export const LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES = 64 * 1024 * 1024;
export const PREVIEW_EAGER_RELEASE_THRESHOLD_BYTES = 32 * 1024 * 1024;

export function isRangeLoadableGLB(file: Pick<File, "name" | "size">) {
  return (
    file.size >= LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES &&
    /\.(?:glb|vrm)$/i.test(file.name)
  );
}

export function assertInputByteLength(
  byteLength: number,
  maxBytes: number,
  label: string,
) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RetargetError("PARSE_INVALID_LENGTH", {
      details: { byteLength, label },
    });
  }
  if (byteLength > maxBytes) {
    throw new RetargetError("FILE_TOO_LARGE", {
      details: { byteLength, label, maxBytes },
    });
  }
}
