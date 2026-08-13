import type { MotionExportAdapter } from "@/adapters/types";
import { exportGLTFAnimation } from "@/export/gltf-animation";

export const gltfAnimationExportAdapter = {
  id: "gltf-animation",
  label: "glTF / GLB Animation",
  maturity: "active",
  extension: ".animation.glb",
  mimeType: "model/gltf-binary",
  exportMotion: exportGLTFAnimation,
} satisfies MotionExportAdapter;
