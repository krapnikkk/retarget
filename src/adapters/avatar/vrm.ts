import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const vrmAvatarAdapter = {
  id: "vrm",
  label: "VRM Avatar",
  profileId: "vrm-humanoid",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "gltf",
      extensions: [".vrm"],
      profile: "vrm-humanoid",
      requiredExtensions: ["VRMC_vrm", "VRM"],
      role: "avatar",
    }, options),
} satisfies AvatarImportAdapter;
