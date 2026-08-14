export const LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES = 64 * 1024 * 1024;
export const PREVIEW_EAGER_RELEASE_THRESHOLD_BYTES = 32 * 1024 * 1024;
export const MAX_RANGE_LOADABLE_AVATAR_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_MOTION_FILE_BYTES = 100 * 1024 * 1024;

export function isRangeLoadableGLB(file: Pick<File, "name" | "size">) {
  return (
    file.size >= LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES &&
    /\.(?:glb|vrm)$/i.test(file.name)
  );
}

export function getAvatarInputLimit(file: Pick<File, "name" | "size">) {
  return /\.(?:glb|vrm)$/i.test(file.name)
    ? MAX_RANGE_LOADABLE_AVATAR_BYTES
    : 200 * 1024 * 1024;
}

export function getAvatarEagerInputLimit(file: Pick<File, "name" | "size">) {
  if (/\.(?:glb|vrm)$/i.test(file.name)) {
    return LARGE_ASSET_RANGE_LOAD_THRESHOLD_BYTES - 1;
  }
  return /\.(?:pmx|pmd)$/i.test(file.name)
    ? 200 * 1024 * 1024
    : MAX_MOTION_FILE_BYTES;
}

export function assertFileWithinLimit(
  file: Pick<File, "name" | "size">,
  maxBytes: number,
  role: "motion" | "avatar" | "resource",
) {
  assertInputByteLength(file.size, maxBytes, `${role}:${file.name}`);
}

export function assertMotionFileWithinLimit(
  file: Pick<File, "name" | "size">,
) {
  assertFileWithinLimit(file, MAX_MOTION_FILE_BYTES, "motion");
}

export function assertAvatarFileWithinLimit(
  file: Pick<File, "name" | "size">,
) {
  assertFileWithinLimit(file, getAvatarInputLimit(file), "avatar");
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
import { RetargetError } from "@/retarget/errors";
