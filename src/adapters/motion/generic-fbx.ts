import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importFBXHumanoidMotion } from "@/import/fbx-motion";
import { GENERIC_FBX_HUMANOID_PROFILE } from "@/profiles";

export const genericFbxMotionAdapter = {
  id: "generic-fbx",
  label: "Generic Humanoid FBX Motion",
  profileId: "generic-fbx-humanoid",
  maturity: "active",
  probe: (file) =>
    probeImportAdapter(file, {
      container: "fbx",
      extensions: [".fbx"],
      profile: "generic-fbx-humanoid",
      role: "motion",
    }),
  importMotion: (file) =>
    importFBXHumanoidMotion({
      file,
      kind: "generic-fbx",
      profile: GENERIC_FBX_HUMANOID_PROFILE,
    }),
} satisfies MotionImportAdapter;
