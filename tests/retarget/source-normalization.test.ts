import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ACTORCORE_PROFILE, VRM_HUMANOID_PROFILE } from "@/profiles";
import { normalizeSourceMotionToCanonical } from "@/retarget/source-normalization";

describe("source motion normalization", () => {
  it("normalizes source units and axes into the canonical VRM basis", () => {
    const result = normalizeSourceMotionToCanonical({
      profile: ACTORCORE_PROFILE,
      tracks: [
        {
          bone: "hips",
          path: "translation",
          times: [0],
          values: [100, 200, 300],
        },
      ],
    });

    expect(result.scaleToMeters).toBe(0.01);
    expect(result.axisCorrectionApplied).toBe(true);
    expect(result.tracks[0]?.values).toEqual([-1, 2, -3]);
  });

  it("removes source rest transforms before emitting world-space deltas", () => {
    const parentWorld = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    const localRest = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      0.3,
    );
    const worldRest = parentWorld.clone().multiply(localRest);
    const restTransforms = new Map([
      [
        "hips" as const,
        {
          localPosition: [3, 4, 5] as [number, number, number],
          parentWorldQuaternion: parentWorld.toArray(),
          worldQuaternion: worldRest.toArray(),
        },
      ],
    ]);

    const result = normalizeSourceMotionToCanonical({
      profile: VRM_HUMANOID_PROFILE,
      restTransforms,
      rotationSemantics: "absolute-local",
      translationSemantics: "absolute-local",
      tracks: [
        {
          bone: "hips",
          path: "rotation",
          times: [0, 1],
          values: [...localRest.toArray(), ...localRest.toArray().map((value) => -value)],
        },
        {
          bone: "hips",
          path: "translation",
          times: [0],
          values: [4, 4, 5],
        },
      ],
    });

    expect(result.usedRestTransforms).toBe(true);
    const rotations = result.tracks[0]?.values ?? [];
    expect(rotations).toHaveLength(8);
    rotations.forEach((value, index) => {
      expect(value).toBeCloseTo([0, 0, 0, 1, 0, 0, 0, 1][index] ?? 0, 12);
    });
    const translation = result.tracks[1]?.values ?? [];
    expect(translation).toHaveLength(3);
    translation.forEach((value, index) => {
      expect(value).toBeCloseTo([0, 0, -1][index] ?? 0, 12);
    });
  });
});
