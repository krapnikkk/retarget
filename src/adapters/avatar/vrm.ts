import type { AvatarImportAdapter } from "@/adapters/types";
import { vrmAvatarImportProbe } from "@/adapters/import-probe-registry";

export const vrmAvatarAdapter = {
  ...vrmAvatarImportProbe,
} satisfies AvatarImportAdapter;
