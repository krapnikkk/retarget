import type { AvatarImportAdapter } from "@/adapters/types";
import { gltfHumanoidAvatarImportProbe } from "@/adapters/import-probe-registry";

export const gltfHumanoidAvatarAdapter = {
  ...gltfHumanoidAvatarImportProbe,
} satisfies AvatarImportAdapter;
