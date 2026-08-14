import type {
  AvatarFormatId,
  MotionExportFormatId,
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
import { collectTransferableGLTFResources } from "@/import/gltf-document";

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

const BETA_MOTION_OUTPUTS = [
  "fbx-animation",
  "gltf-animation",
  "motion-json",
  "vrma",
] as const;

const importedMotionToAvatarPairPipelines = MOTION_FORMATS.flatMap(
  (motionFormat) =>
    AVATAR_FORMATS.map((avatarFormat) =>
      createImportedMotionToAvatarPipeline(motionFormat, avatarFormat),
    ),
);

export const importedMotionToAvatarPipelines = [
  ...importedMotionToAvatarPairPipelines,
  ...BETA_MOTION_OUTPUTS.map((outputFormat) =>
    createImportedMotionToAvatarPipeline(
      "gltf-animation",
      "gltf-humanoid",
      {
        assurance: "beta",
        availability: "available",
        outputFormat,
      },
    ),
  ),
];

function createImportedMotionToAvatarPipeline(
  motionFormat: MotionFormatId,
  avatarFormat: AvatarFormatId,
  override?: Pick<RetargetPipeline, "assurance" | "availability"> & {
    outputFormat: MotionExportFormatId;
  },
): RetargetPipeline {
  const isMixamoToVrm = motionFormat === "mixamo-fbx" && avatarFormat === "vrm";
  const isAnimatedGlbBetaPath =
    avatarFormat === "gltf-humanoid" &&
    (motionFormat === "gltf-animation" || motionFormat === "vrma");
  const isBakedVrmBetaPath =
    (motionFormat === "gltf-animation" ||
      motionFormat === "bvh" ||
      motionFormat === "vmd") &&
    avatarFormat === "vrm";
  const outputFormat = override?.outputFormat ?? (
    isAnimatedGlbBetaPath
      ? "animated-glb"
      : isBakedVrmBetaPath
        ? "baked-vrm"
        : isMixamoToVrm
          ? "vrma"
          : "gltf-animation"
  );

  const pipeline: RetargetPipeline = {
    id: `${motionFormat}-to-${avatarFormat}-to-${outputFormat}` as RetargetPipelineId,
    label: `${motionFormat} to ${avatarFormat} to ${outputFormat}`,
    motionFormat,
    avatarFormat,
    outputFormat,
    availability:
      override?.availability ??
      (isAnimatedGlbBetaPath || isBakedVrmBetaPath ? "available" : "hidden"),
    assurance:
      override?.assurance ??
      (isAnimatedGlbBetaPath || isBakedVrmBetaPath ? "beta" : "experimental"),
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

      const motionBytes = await readFileArrayBufferWithSignal(
        motionFile,
        MAX_MOTION_FILE_BYTES,
        "motion",
        signal,
      );
      const resources = motionFormat === "gltf-animation"
        ? await collectTransferableGLTFResources(
            new Uint8Array(motionBytes),
            motionFile,
            signal,
          )
        : undefined;
      const sourceClip = await runRetargetJob(
        {
          type: "import-motion",
          formatId: motionFormat,
          filename: motionFile.name,
          bytes: motionBytes,
          resources,
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
        : outputFormat === "baked-vrm"
          ? await import("@/export/avatar-glb").then(({ exportBakedVRM }) =>
              exportBakedVRM({
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
