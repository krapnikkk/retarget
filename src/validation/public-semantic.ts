import type {
  HumanoidBoneName,
  RetargetedMotionClip,
} from "@/retarget/types";
import { sampleSemanticMotionPose as sampleInternalSemanticMotionPose } from "./semantic-fk-oracle";

export type SemanticSampledPose = Partial<
  Record<
    HumanoidBoneName,
    {
      rotation?: [number, number, number, number];
      position?: [number, number, number];
    }
  >
>;

export function sampleSemanticMotionPose(
  clip: RetargetedMotionClip,
  time: number,
): SemanticSampledPose {
  return sampleInternalSemanticMotionPose(clip, time);
}
