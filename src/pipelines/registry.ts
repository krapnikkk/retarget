import type {
  AvatarFormatId,
  MotionFormatId,
  RetargetPipeline,
} from "@/formats";
import { importedMotionToAvatarPipelines } from "./imported-motion-to-avatar";

export const RETARGET_PIPELINES = importedMotionToAvatarPipelines satisfies readonly RetargetPipeline[];

export function getRetargetPipeline(
  motionFormat: MotionFormatId,
  avatarFormat: AvatarFormatId,
) {
  return (
    RETARGET_PIPELINES.find(
      (pipeline) =>
        pipeline.motionFormat === motionFormat &&
        pipeline.avatarFormat === avatarFormat,
    ) ?? null
  );
}
