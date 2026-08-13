import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const mixamoRiggedAvatarAdapter = {
  id: "mixamo-rigged",
  label: "Mixamo-rigged Avatar",
  profileId: "mixamo",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: file.name.toLowerCase().endsWith(".fbx") ? "fbx" : "gltf",
      ecosystemMarkers: ["mixamorigHips", "mixamorig:LeftArm"],
      extensions: [".fbx", ".glb"],
      profile: "mixamo",
      role: "avatar",
    }),
} satisfies AvatarImportAdapter;
