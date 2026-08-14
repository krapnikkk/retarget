import { importGLTFAnimation } from "./import/gltf-animation";

export { importBVH } from "./import/bvh";
export { importFBXHumanoidMotionBytes } from "./import/fbx-motion";
export { importVMD } from "./import/vmd";
export { importVRMA } from "./import/vrma";

export function importGLTFAnimationBytes(
  bytes: Uint8Array,
  filename = "motion.glb",
) {
  return importGLTFAnimation(bytes, filename);
}

export { exportBVH } from "./export/bvh";
export { exportFBXAnimation } from "./export/fbx";
export { exportGLTFAnimation } from "./export/gltf-animation";
export { exportVMD } from "./export/vmd";
export { exportVRMA } from "./export/vrma";
export { parseMotionClip, serializeMotionClip } from "./retarget/motion-clip";
export type { BoneNamingOptions } from "./export/bone-naming";
