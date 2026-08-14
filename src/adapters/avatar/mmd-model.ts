import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const mmdModelAvatarAdapter = {
  id: "mmd-model",
  label: "MMD PMX / PMD Avatar",
  profileId: "mmd-body",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "mmd-model",
      extensions: [".pmx", ".pmd"],
      profile: "mmd-body",
      role: "avatar",
    }, options),
} satisfies AvatarImportAdapter;
