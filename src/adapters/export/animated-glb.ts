import type { AvatarExportAdapter } from "@/adapters/types";
import { exportAnimatedGLB } from "@/export/avatar-glb";

export const animatedGlbExportAdapter = {
  id: "animated-glb",
  label: "Animated GLB",
  maturity: "active",
  extension: ".animated.glb",
  mimeType: "model/gltf-binary",
  exportAvatar: exportAnimatedGLB,
} satisfies AvatarExportAdapter;
