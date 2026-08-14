import type {
  AvatarFormatId,
  MotionFormatId,
} from "@/formats";
import type {
  RetargetPipeline,
  RetargetPipelineOutputFormatId,
} from "./types";
import { importedMotionToAvatarPipelines } from "./imported-motion-to-avatar";

export const RETARGET_PIPELINES: readonly RetargetPipeline[] = Object.freeze(
  importedMotionToAvatarPipelines
    .filter((pipeline) => pipeline.availability === "available")
    .sort((left, right) => left.id.localeCompare(right.id)),
);

export function getRetargetPipeline(
  motionFormat: MotionFormatId,
  avatarFormat: AvatarFormatId,
  outputFormat: RetargetPipelineOutputFormatId,
) {
  return (
    RETARGET_PIPELINES.find(
      (pipeline) =>
        pipeline.motionFormat === motionFormat &&
        pipeline.avatarFormat === avatarFormat &&
        pipeline.outputFormat === outputFormat,
    ) ?? null
  );
}
