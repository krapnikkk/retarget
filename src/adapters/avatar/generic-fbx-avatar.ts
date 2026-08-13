import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const genericFbxAvatarAdapter = {
  id: "generic-fbx-avatar",
  label: "Generic Humanoid FBX Avatar",
  profileId: "generic-fbx-humanoid",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: "fbx",
      extensions: [".fbx"],
      profile: "generic-fbx-humanoid",
      role: "avatar",
    }),
} satisfies AvatarImportAdapter;
