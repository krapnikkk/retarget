import type { MotionImportAdapter } from "@/adapters/types";
import { gltfAnimationMotionImportProbe } from "@/adapters/import-probe-registry";
import { importGLTFAnimation } from "@/import/gltf-animation";
import { assertMotionFileWithinLimit } from "@/jobs/asset-memory-policy";

export const gltfAnimationMotionAdapter = {
  ...gltfAnimationMotionImportProbe,
  async importMotion(file) {
    assertMotionFileWithinLimit(file);
    return importGLTFAnimation(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      file,
    );
  },
} satisfies MotionImportAdapter;
