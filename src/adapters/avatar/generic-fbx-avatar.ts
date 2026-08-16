import type { AvatarImportAdapter } from "@/adapters/types";
import { genericFbxAvatarImportProbe } from "@/adapters/import-probe-registry";

export const genericFbxAvatarAdapter = {
  ...genericFbxAvatarImportProbe,
} satisfies AvatarImportAdapter;
