import type {
  AvatarFormatId,
  MotionFormatId,
} from "@/formats";
import type { RetargetPipeline } from "./types";
import { importedMotionToAvatarPipelines } from "./imported-motion-to-avatar";

export const RETARGET_PIPELINES: readonly RetargetPipeline[] = Object.freeze(
  importedMotionToAvatarPipelines.filter(
    (pipeline) => pipeline.availability === "available",
  ),
);

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
