import type { MotionImportAdapter } from "@/adapters/types";
import { gltfAnimationMotionImportProbe } from "@/adapters/import-probe-registry";
import { importGLTFAnimation } from "@/import/gltf-animation";

export const gltfAnimationMotionAdapter = {
  ...gltfAnimationMotionImportProbe,
  async importMotion(file) {
    return importGLTFAnimation(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      file,
    );
  },
} satisfies MotionImportAdapter;
