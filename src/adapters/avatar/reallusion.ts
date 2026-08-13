import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const reallusionAvatarAdapter = {
  id: "reallusion",
  label: "Reallusion-compatible Avatar",
  profileId: "actorcore",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: file.name.toLowerCase().endsWith(".fbx") ? "fbx" : "gltf",
      ecosystemMarkers: ["CC_Base_Hip", "CC_Base_L_Upperarm"],
      extensions: [".fbx", ".glb"],
      profile: "actorcore",
      role: "avatar",
    }),
} satisfies AvatarImportAdapter;
