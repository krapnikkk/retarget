import type { AvatarImportAdapter } from "@/adapters/types";
import { mmdModelAvatarImportProbe } from "@/adapters/import-probe-registry";

export const mmdModelAvatarAdapter = {
  ...mmdModelAvatarImportProbe,
} satisfies AvatarImportAdapter;
