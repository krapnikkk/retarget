import type {
  AvatarFormatId,
  MotionFormatId,
  RetargetPipeline,
  RetargetPipelineId,
} from "@/formats";
import {
  findAvatarImportAdapter,
  vrmAvatarAdapter,
} from "@/adapters/avatar";
import {
  findMotionImportAdapter,
  mixamoFbxMotionAdapter,
} from "@/adapters/motion";
import { createRetargetError } from "@/retarget";

const MOTION_FORMATS = [
  "mixamo-fbx",
  "vrma",
  "bvh",
  "vmd",
  "gltf-animation",
  "actorcore-fbx",
  "generic-fbx",
] as const satisfies readonly MotionFormatId[];

const AVATAR_FORMATS = [
  "vrm",
  "gltf-humanoid",
  "mixamo-rigged",
  "ready-player-me",
  "reallusion",
  "mmd-model",
  "generic-fbx-avatar",
] as const satisfies readonly AvatarFormatId[];

export const importedMotionToAvatarPipelines = MOTION_FORMATS.flatMap(
  (motionFormat) =>
    AVATAR_FORMATS.map((avatarFormat) =>
      createImportedMotionToAvatarPipeline(motionFormat, avatarFormat),
    ),
);

function createImportedMotionToAvatarPipeline(
  motionFormat: MotionFormatId,
  avatarFormat: AvatarFormatId,
): RetargetPipeline {
  const isMixamoToVrm = motionFormat === "mixamo-fbx" && avatarFormat === "vrm";

  return {
    id: `${motionFormat}-to-${avatarFormat}` as RetargetPipelineId,
    label: `${motionFormat} to ${avatarFormat}`,
    motionFormat,
    avatarFormat,
    outputFormats: ["vrma", "motion-json", "vmd", "gltf-animation", "bvh"],
    availability: "available",
    assurance: isMixamoToVrm ? "beta" : "experimental",
    async retarget({
      motionFile,
      avatarFile,
      solveOptions,
      mapping,
      signal,
    }) {
      signal?.throwIfAborted();
      const motionAdapter = isMixamoToVrm
        ? mixamoFbxMotionAdapter
        : await findMotionImportAdapter(motionFile, motionFormat);
      if (!motionAdapter?.importMotion) {
        throw createRetargetError("UNSUPPORTED_FORMAT", motionFile.name);
      }
      if (isMixamoToVrm) {
        const motionProbe = await motionAdapter.probe(motionFile);
        if (motionProbe.confidence < 0.35) {
          throw createRetargetError("FBX_PARSE_FAILED");
        }
      }
      const avatarAdapter = isMixamoToVrm
        ? vrmAvatarAdapter
        : await findAvatarImportAdapter(avatarFile, avatarFormat);
      if (!avatarAdapter) {
        throw createRetargetError("UNSUPPORTED_FORMAT", avatarFile.name);
      }
      if (isMixamoToVrm) {
        const avatarProbe = await avatarAdapter.probe(avatarFile);
        if (avatarProbe.confidence < 0.35) {
          throw createRetargetError("VRM_PARSE_FAILED");
        }
      }
      const { bindMotionClipToAvatar } = await import(
        "@/browser/avatar-target-pipeline"
      );

      const sourceClip = await motionAdapter.importMotion(motionFile);
      signal?.throwIfAborted();
      const solvedClip = await bindMotionClipToAvatar({
        avatarFile,
        avatarFormatId: avatarFormat,
        clip: sourceClip,
        mappingConfig: mapping,
        solveOptions,
        signal,
      });
      return { sourceClip, solvedClip };
    },
  };
}
