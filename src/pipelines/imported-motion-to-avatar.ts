import type {
  AvatarFormatId,
  MotionFormatId,
} from "@/formats";
import type { RetargetPipeline, RetargetPipelineId } from "./types";
import {
  findAvatarImportAdapter,
  vrmAvatarAdapter,
} from "@/adapters/avatar";
import {
  findMotionImportAdapter,
  mixamoFbxMotionAdapter,
} from "@/adapters/motion";
import { createRetargetError } from "@/retarget";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { MAX_MOTION_FILE_BYTES } from "@/jobs/asset-memory-policy";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";

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
  const isGoldenHumanoidPath =
    motionFormat === "gltf-animation" && avatarFormat === "gltf-humanoid";
  const outputFormat = isGoldenHumanoidPath
    ? "animated-glb"
    : isMixamoToVrm
      ? "vrma"
      : "gltf-animation";

  const pipeline: RetargetPipeline = {
    id: `${motionFormat}-to-${avatarFormat}-to-${outputFormat}` as RetargetPipelineId,
    label: `${motionFormat} to ${avatarFormat} to ${outputFormat}`,
    motionFormat,
    avatarFormat,
    outputFormat,
    availability: isGoldenHumanoidPath ? "available" : "hidden",
    assurance: isGoldenHumanoidPath ? "beta" : "experimental",
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
      if (!motionAdapter) {
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

      const sourceClip = await runRetargetJob(
        {
          type: "import-motion",
          formatId: motionFormat,
          filename: motionFile.name,
          bytes: await readFileArrayBufferWithSignal(
            motionFile,
            MAX_MOTION_FILE_BYTES,
            "motion",
            signal,
          ),
        },
        { signal },
      );
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
    async run(input) {
      const result = await pipeline.retarget(input);
      input.signal?.throwIfAborted();
      const bytes = outputFormat === "animated-glb"
        ? await import("@/export/avatar-glb").then(({ exportAnimatedGLB }) =>
            exportAnimatedGLB({
              avatarFile: input.avatarFile,
              avatarFormatId: avatarFormat,
              clip: result.solvedClip,
              signal: input.signal,
            }),
          )
        : await runRetargetJob(
            {
              type: "export-motion",
              formatId: outputFormat,
              clip: result.solvedClip,
            },
            { signal: input.signal },
          );
      input.signal?.throwIfAborted();
      return {
        ...result,
        output: { format: outputFormat, bytes },
      };
    },
  };
  return pipeline;
}
