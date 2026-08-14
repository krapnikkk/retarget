import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const readyPlayerMeAvatarAdapter = {
  id: "ready-player-me",
  label: "Ready Player Me Avatar",
  profileId: "ready-player-me",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "gltf",
      ecosystemMarkers: ["Wolf3D_Head", "Wolf3D_Body"],
      extensions: [".glb"],
      profile: "ready-player-me",
      role: "avatar",
    }, options),
} satisfies AvatarImportAdapter;
