import type { AvatarImportAdapter } from "@/adapters/types";
import { reallusionAvatarImportProbe } from "@/adapters/import-probe-registry";

export const reallusionAvatarAdapter = {
  ...reallusionAvatarImportProbe,
} satisfies AvatarImportAdapter;
