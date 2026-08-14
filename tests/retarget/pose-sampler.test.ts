import { describe, expect, it } from "vitest";
import {
  MOTION_CLIP_SCHEMA_VERSION,
  normalizeMotionTime,
  sampleMotionClipPose,
  sampleMotionClipPoseForAvatarPreview,
  type RetargetedMotionClip,
} from "@/retarget";

const clip: RetargetedMotionClip = {
  schemaVersion: MOTION_CLIP_SCHEMA_VERSION,
  name: "sample",
  duration: 1,
  fps: 30,
  source: {
    kind: "mixamo-fbx",
    filename: "walk.fbx",
  },
  target: {
    kind: "vrm",
    filename: "avatar.vrm",
  },
  processing: {
    stage: "canonical",
    sourceCanonicalId: "pose-sampler-test",
  },
  tracks: [
    {
      bone: "hips",
      path: "translation",
      times: [0, 1],
      values: [0, 0, 0, 0, 2, 0],
    },
    {
      bone: "leftUpperArm",
      path: "rotation",
      times: [0, 1],
      values: [0, 0, 0, 1, 0, 0, 1, 0],
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("sampleMotionClipPose", () => {
  it("interpolates translation tracks", () => {
    expect(sampleMotionClipPose(clip, 0.5, false).hips?.position).toEqual([
      0, 1, 0,
    ]);
  });

  it("slerps rotation tracks with quaternion continuity", () => {
    const rotation = sampleMotionClipPose(clip, 0.5, false).leftUpperArm
      ?.rotation;

    expect(rotation?.[2]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(rotation?.[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("normalizes quaternion endpoints before selecting the slerp branch", () => {
    const nonUnitClip: RetargetedMotionClip = {
      ...clip,
      tracks: [
        {
          bone: "leftUpperArm",
          path: "rotation",
          times: [0, 1],
          values: [0, 0, 0, 2, 0, 0, 1.5, 1.5],
        },
      ],
    };
    const rotation = sampleMotionClipPose(nonUnitClip, 0.5, false)
      .leftUpperArm?.rotation;

    expect(rotation).toBeDefined();
    expect(Math.hypot(...rotation!)).toBeCloseTo(1, 6);
    expect(rotation?.[2]).toBeCloseTo(Math.sin(Math.PI / 8), 6);
    expect(rotation?.[3]).toBeCloseTo(Math.cos(Math.PI / 8), 6);
  });

  it("clamps non-looping samples to the first and last authored keyframes", () => {
    const insetKeyframes: RetargetedMotionClip = {
      ...clip,
      tracks: [{
        bone: "hips",
        path: "translation",
        times: [0.25, 0.75],
        values: [1, 2, 3, 4, 5, 6],
      }],
    };

    expect(sampleMotionClipPose(insetKeyframes, 0, false).hips?.position).toEqual([
      1, 2, 3,
    ]);
    expect(sampleMotionClipPose(insetKeyframes, 1, false).hips?.position).toEqual([
      4, 5, 6,
    ]);
  });

  it("wraps motion time when looped", () => {
    expect(normalizeMotionTime(1.25, 1, true)).toBeCloseTo(0.25);
    expect(normalizeMotionTime(-0.25, 1, true)).toBeCloseTo(0.75);
  });

  it("compensates imported VRMA root motion when a VRM0 avatar is display-rotated", () => {
    const vrmaClip: RetargetedMotionClip = {
      ...clip,
      source: {
        kind: "vrma",
        filename: "walk.vrma",
      },
      tracks: [
        {
          bone: "hips",
          path: "translation",
          times: [0, 1],
          values: [1, 2, 3, 4, 5, 6],
        },
      ],
    };

    expect(
      sampleMotionClipPoseForAvatarPreview(vrmaClip, 0, false, {
        vrm0FacingCorrection: true,
      }).hips?.position,
    ).toEqual([-1, 2, -3]);
    expect(
      sampleMotionClipPoseForAvatarPreview(vrmaClip, 0, false, {
        vrm0FacingCorrection: false,
      }).hips?.position,
    ).toEqual([1, 2, 3]);
    expect(
      sampleMotionClipPoseForAvatarPreview(clip, 0, false, {
        vrm0FacingCorrection: true,
      }).hips?.position,
    ).toEqual([0, 0, 0]);
  });
});
