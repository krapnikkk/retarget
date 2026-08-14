import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const gltfHumanoidAvatarAdapter = {
  id: "gltf-humanoid",
  label: "glTF / GLB Humanoid Avatar",
  profileId: "generic-gltf-humanoid",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "gltf",
      extensions: [".glb", ".gltf"],
      profile: "generic-gltf-humanoid",
      role: "avatar",
    }, options),
} satisfies AvatarImportAdapter;
