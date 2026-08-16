import type { MotionImportAdapter } from "@/adapters/types";
import { genericFbxMotionImportProbe } from "@/adapters/import-probe-registry";
import { importFBXHumanoidMotion } from "@/import/fbx-motion";
import { GENERIC_FBX_HUMANOID_PROFILE } from "@/profiles";

export const genericFbxMotionAdapter = {
  ...genericFbxMotionImportProbe,
  importMotion: (file, options) =>
    importFBXHumanoidMotion({
      file,
      kind: "generic-fbx",
      profile: GENERIC_FBX_HUMANOID_PROFILE,
      ...options,
    }),
} satisfies MotionImportAdapter;
