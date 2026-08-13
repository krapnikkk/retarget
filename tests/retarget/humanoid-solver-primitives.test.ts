import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { MIXAMO_RIG_PROFILE, VRM_HUMANOID_PROFILE } from "@/profiles";
import {
  bakeSwingTwistTracks,
  createRetargetBasis,
  decomposeSwingTwist,
  HUMANOID_CHAIN_CONFIGS,
} from "@/solvers";

describe("createRetargetBasis", () => {
  it("uses rig profiles and applies the VRM 0.x facing correction", () => {
    const basis = createRetargetBasis({
      sourceProfile: MIXAMO_RIG_PROFILE,
      targetProfile: VRM_HUMANOID_PROFILE,
      targetMetaVersion: "0",
    });

    expect(basis).toMatchObject({
      sourceProfileId: "mixamo",
      targetProfileId: "vrm-humanoid",
      sourceForwardAxis: "z",
      targetForwardAxis: "-z",
      axisCorrectionApplied: true,
    });
  });

  it("keeps the normalized humanoid basis for VRM 1.0 targets", () => {
    const basis = createRetargetBasis({
      sourceProfile: MIXAMO_RIG_PROFILE,
      targetProfile: VRM_HUMANOID_PROFILE,
      targetMetaVersion: "1",
    });

    expect(basis.axisCorrectionApplied).toBe(false);
  });
});

describe("humanoid swing/twist primitives", () => {
  it("keeps the active humanoid chain contract explicit", () => {
    expect(HUMANOID_CHAIN_CONFIGS.map((config) => config.id)).toEqual([
      "spine",
      "leftArm",
      "rightArm",
      "leftLeg",
      "rightLeg",
    ]);
  });

  it("decomposes a rotation into swing and twist components", () => {
    const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5);
    const swing = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.25);
    const source = swing.clone().multiply(twist);
    const result = decomposeSwingTwist(source, new Vector3(0, 1, 0));

    expect(result.twist.angleTo(twist)).toBeCloseTo(0, 6);
    expect(result.swing.clone().multiply(result.twist).angleTo(source)).toBeCloseTo(
      0,
      6,
    );
  });

  it("bakes configured rotation tracks without changing translation tracks", () => {
    const translation = {
      bone: "hips" as const,
      path: "translation" as const,
      times: [0],
      values: [1, 2, 3],
    };
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 0), 0.5);

    const baked = bakeSwingTwistTracks([
      translation,
      {
        bone: "spine",
        path: "rotation",
        times: [0],
        values: rotation.toArray(),
      },
    ]);

    expect(baked[0]).toBe(translation);
    expect(new Quaternion().fromArray(baked[1]?.values ?? []).length()).toBeCloseTo(1, 6);
  });
});
