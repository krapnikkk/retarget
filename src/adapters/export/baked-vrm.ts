import type { AvatarExportAdapter } from "@/adapters/types";
import { exportBakedVRM } from "@/export/avatar-glb";

export const bakedVrmExportAdapter = {
  id: "baked-vrm",
  label: "VRM 1.0 with embedded glTF animation (experimental)",
  maturity: "active",
  extension: ".animated.vrm",
  mimeType: "model/gltf-binary",
  exportAvatar: exportBakedVRM,
} satisfies AvatarExportAdapter;
