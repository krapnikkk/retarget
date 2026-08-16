import type { MotionImportAdapter } from "@/adapters/types";
import { actorcoreFbxMotionImportProbe } from "@/adapters/import-probe-registry";
import { importFBXHumanoidMotion } from "@/import/fbx-motion";
import { ACTORCORE_PROFILE } from "@/profiles";

export const actorcoreFbxMotionAdapter = {
  ...actorcoreFbxMotionImportProbe,
  importMotion: (file, options) =>
    importFBXHumanoidMotion({
      file,
      kind: "actorcore-fbx",
      profile: ACTORCORE_PROFILE,
      ...options,
    }),
} satisfies MotionImportAdapter;
