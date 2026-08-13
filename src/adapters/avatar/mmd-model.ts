import type { AvatarImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";

export const mmdModelAvatarAdapter = {
  id: "mmd-model",
  label: "MMD PMX / PMD Avatar",
  profileId: "mmd-body",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: "mmd-model",
      extensions: [".pmx", ".pmd"],
      profile: "mmd-body",
      role: "avatar",
    }),
} satisfies AvatarImportAdapter;
