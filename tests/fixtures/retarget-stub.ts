import {
  DEFAULT_RETARGET_OPTIONS,
  MOTION_CLIP_SCHEMA_VERSION,
  type CanonicalHumanoidMotionClip,
  type RetargetOptions,
  type SolvedHumanoidMotionClip,
  type TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget/types";
import { createCanonicalHumanoidMotionClip } from "@/retarget/canonical-motion";

export type RetargetStubInput = {
  vrmFile: FileLike;
  fbxFile: FileLike;
  options?: Partial<RetargetOptions>;
};

export type FileLike = {
  name: string;
};

export function createRetargetedMotionClipStub({
  fbxFile,
  options,
}: RetargetStubInput): CanonicalHumanoidMotionClip {
  const mergedOptions = {
    ...DEFAULT_RETARGET_OPTIONS,
    ...options,
  };
  const duration = 2;

  return createCanonicalHumanoidMotionClip({
    schemaVersion: MOTION_CLIP_SCHEMA_VERSION,
    name: stripExtension(fbxFile.name) || "mixamo-motion",
    duration,
    fps: 30,
    source: {
      kind: "mixamo-fbx",
      filename: fbxFile.name,
    },
    tracks: [
      {
        bone: "hips",
        path: "translation",
        times: [0, 1, duration],
        values: mergedOptions.rootMotion
          ? [0, 0, 0, 0, 0.03 * mergedOptions.heightScale, 0.02, 0, 0, 0]
          : [0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        bone: "hips",
        path: "rotation",
        times: [0, 1, duration],
        values: [0, 0, 0, 1, 0, 0.08, 0, 0.997, 0, 0, 0, 1],
      },
      {
        bone: "spine",
        path: "rotation",
        times: [0, 1, duration],
        values: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
      {
        bone: "leftUpperArm",
        path: "rotation",
        times: [0, 1, duration],
        values: [
          0,
          0,
          0,
          1,
          0.18 + mergedOptions.armOffsetDegrees / 180,
          0,
          0,
          0.984,
          0,
          0,
          0,
          1,
        ],
      },
      {
        bone: "rightUpperArm",
        path: "rotation",
        times: [0, 1, duration],
        values: [
          0,
          0,
          0,
          1,
          -0.18 - mergedOptions.armOffsetDegrees / 180,
          0,
          0,
          0.984,
          0,
          0,
          0,
          1,
        ],
      },
      {
        bone: "leftUpperLeg",
        path: "rotation",
        times: [0, 1, duration],
        values: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
      {
        bone: "rightUpperLeg",
        path: "rotation",
        times: [0, 1, duration],
        values: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
    ],
  });
}

export function bindSolvedMotionClipStub(
  clip: SolvedHumanoidMotionClip,
  target: Partial<TargetBoundSolvedHumanoidMotionClip["target"]> = {},
): TargetBoundSolvedHumanoidMotionClip {
  return {
    ...clip,
    target: {
      kind: "vrm",
      filename: "avatar.vrm",
      rigSignature: "humanoid-rest-v1:test",
      ...target,
    },
  };
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}
