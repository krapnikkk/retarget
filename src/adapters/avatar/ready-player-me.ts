import type { AvatarImportAdapter } from "@/adapters/types";
import { readyPlayerMeAvatarImportProbe } from "@/adapters/import-probe-registry";

export const readyPlayerMeAvatarAdapter = {
  ...readyPlayerMeAvatarImportProbe,
} satisfies AvatarImportAdapter;
