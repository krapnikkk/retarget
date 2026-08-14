import type { MotionImportAdapter } from "@/adapters/types";
import { probeImportAdapter } from "@/adapters/probe";
import { importFBXHumanoidMotion } from "@/import/fbx-motion";
import { MIXAMO_RIG_PROFILE } from "@/profiles";

export const mixamoFbxMotionAdapter = {
  id: "mixamo-fbx",
  label: "Mixamo FBX Motion",
  profileId: "mixamo",
  maturity: "active",
  probe: (file, options) =>
    probeImportAdapter(file, {
      container: "fbx",
      ecosystemMarkers: ["mixamorigHips", "mixamorig:LeftArm"],
      extensions: [".fbx"],
      profile: "mixamo",
      role: "motion",
    }, options),
  importMotion: (file, options) =>
    importFBXHumanoidMotion({
      file,
      kind: "mixamo-fbx",
      profile: MIXAMO_RIG_PROFILE,
      ...options,
    }),
} satisfies MotionImportAdapter;
