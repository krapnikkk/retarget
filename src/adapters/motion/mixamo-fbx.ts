import type { MotionImportAdapter } from "@/adapters/types";
import { mixamoFbxMotionImportProbe } from "@/adapters/import-probe-registry";
import { importFBXHumanoidMotion } from "@/import/fbx-motion";
import { MIXAMO_RIG_PROFILE } from "@/profiles";

export const mixamoFbxMotionAdapter = {
  ...mixamoFbxMotionImportProbe,
  importMotion: (file, options) =>
    importFBXHumanoidMotion({
      file,
      kind: "mixamo-fbx",
      profile: MIXAMO_RIG_PROFILE,
      ...options,
    }),
} satisfies MotionImportAdapter;
