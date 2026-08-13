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
