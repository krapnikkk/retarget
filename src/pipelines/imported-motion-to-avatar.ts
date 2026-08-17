import type {
  AvatarFormatId,
  MotionExportFormatId,
  MotionFormatId,
} from "@/formats";
import type { RetargetPipeline, RetargetPipelineId } from "./types";
import { findAvatarImportAdapter } from "@/adapters/avatar";
import { findMotionImportAdapter } from "@/adapters/motion";
import { createRetargetError } from "@/retarget";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";
import { collectTransferableGLTFResources } from "@/import/gltf-document";

type ImportedMotionPipelineOutput =
  | MotionExportFormatId
  | "animated-glb"
  | "baked-vrm";

export const importedMotionToAvatarPipelines = [
  createImportedMotionToAvatarPipeline("bvh", "vrm", "baked-vrm"),
  createImportedMotionToAvatarPipeline(
    "gltf-animation",
    "gltf-humanoid",
    "animated-glb",
  ),
  createImportedMotionToAvatarPipeline(
    "gltf-animation",
    "gltf-humanoid",
    "fbx-animation",
  ),
  createImportedMotionToAvatarPipeline(
    "gltf-animation",
    "gltf-humanoid",
    "gltf-animation",
  ),
  createImportedMotionToAvatarPipeline(
    "gltf-animation",
    "gltf-humanoid",
    "motion-json",
  ),
  createImportedMotionToAvatarPipeline(
    "gltf-animation",
    "gltf-humanoid",
    "vrma",
  ),
  createImportedMotionToAvatarPipeline("gltf-animation", "vrm", "baked-vrm"),
  createImportedMotionToAvatarPipeline("vmd", "vrm", "baked-vrm"),
  createImportedMotionToAvatarPipeline(
    "vrma",
    "gltf-humanoid",
    "animated-glb",
  ),
];

function createImportedMotionToAvatarPipeline(
  motionFormat: MotionFormatId,
  avatarFormat: AvatarFormatId,
  outputFormat: ImportedMotionPipelineOutput,
): RetargetPipeline {
  const pipeline: RetargetPipeline = {
    id: `${motionFormat}-to-${avatarFormat}-to-${outputFormat}` as RetargetPipelineId,
    label: `${motionFormat} to ${avatarFormat} to ${outputFormat}`,
    motionFormat,
    avatarFormat,
    outputFormat,
    assurance: "beta",
    async retarget({
      motionFile,
      avatarFile,
      solveOptions,
      mapping,
      animationIndex,
      animationName,
      signal,
    }) {
      signal?.throwIfAborted();
      const motionAdapter = await findMotionImportAdapter(
        motionFile,
        motionFormat,
      );
      if (!motionAdapter) {
        throw createRetargetError("UNSUPPORTED_FORMAT", motionFile.name);
      }
      const avatarAdapter = await findAvatarImportAdapter(
        avatarFile,
        avatarFormat,
      );
      if (!avatarAdapter) {
        throw createRetargetError("UNSUPPORTED_FORMAT", avatarFile.name);
      }
      const { bindMotionClipToAvatar } = await import(
        "@/browser/avatar-target-pipeline"
      );

      const motionBytes = await readFileArrayBufferWithSignal(
        motionFile,
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
          animationIndex,
          animationName,
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
