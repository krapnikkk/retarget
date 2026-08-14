import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  bindCanonicalHipsTranslationsToRest,
  bindCanonicalRotationDeltasToTargetLocal,
  bindCanonicalRotationsToRest,
  bindCanonicalTracksToTargetRest,
  bindCanonicalTranslationOffsetsToTargetLocal,
  createCanonicalToTargetWorldCorrection,
} from "@/retarget/target-binding";
import { GENERIC_GLTF_HUMANOID_PROFILE } from "@/profiles";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";
import type { TargetBoneRestTransform } from "@/retarget/target-binding";

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

describe("generic avatar canonical motion binding", () => {
  it("converts normalized rotation deltas back into the target rest basis", () => {
    const parentWorld = new Quaternion().setFromAxisAngle(
      X_AXIS,
      -Math.PI / 2,
    );
    const localRest = new Quaternion().setFromAxisAngle(X_AXIS, 1.82);
    const worldRest = parentWorld.clone().multiply(localRest);
    const rest = createRestTransform({
      parentWorldQuaternion: parentWorld,
      worldQuaternion: worldRest,
    });

    const identityBound = new Quaternion().fromArray(
      bindCanonicalRotationsToRest([0, 0, 0, 1], rest),
    );
    expect(identityBound.angleTo(localRest)).toBeLessThan(1e-6);

    const canonicalDelta = new Quaternion().setFromAxisAngle(Y_AXIS, 0.42);
    const bound = new Quaternion().fromArray(
      bindCanonicalRotationsToRest(canonicalDelta.toArray(), rest),
    );
    const normalizedRoundTrip = bound
      .clone()
      .premultiply(parentWorld)
      .multiply(worldRest.clone().invert())
      .normalize();
    expect(normalizedRoundTrip.angleTo(canonicalDelta)).toBeLessThan(1e-6);
  });

  it("maps canonical hips offsets into the target parent coordinate space", () => {
    const parentWorldQuaternion = new Quaternion().setFromAxisAngle(
      X_AXIS,
      -Math.PI / 2,
    );
    const parentWorldMatrix = new Matrix4().compose(
      new Vector3(),
      parentWorldQuaternion,
      new Vector3(1, 1, 1),
    );
    const targetRestLocal = new Vector3(0, 0.05, 0.92);
    const targetRestWorld = targetRestLocal
      .clone()
      .applyMatrix4(parentWorldMatrix);
    const rest = createRestTransform({
      parentWorldMatrix,
      parentWorldQuaternion,
      worldPosition: targetRestWorld,
    });
    const sourceRestHipsHeight = 0.9;
    const targetRestHipsHeight = targetRestWorld.y;
    const scale = targetRestHipsHeight / sourceRestHipsHeight;

    const [x, y, z] = bindCanonicalHipsTranslationsToRest({
      rest,
      sourceRestHipsHeight,
      targetRestHipsHeight,
      values: [0.1, 1.0, 0.2],
    });
    const reboundWorld = new Vector3(x, y, z).applyMatrix4(parentWorldMatrix);
    const expectedWorld = targetRestWorld.clone().add(
      new Vector3(0.1, 0.1, 0.2).multiplyScalar(scale),
    );
    expect(reboundWorld.distanceTo(expectedWorld)).toBeLessThan(1e-6);
  });

  it("omits unscaled root motion when the source unit is unknown", () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.glb" },
      fbxFile: { name: "motion.vmd" },
    });
    clip.metadata = { rootTranslationSpace: "offset-source-units" };
    clip.tracks = [clip.tracks[0]!];

    expect(
      bindCanonicalTracksToTargetRest(clip, {
        bones: new Map([["hips", createRestTransform({})]]),
        restHipsHeight: 0.9,
      }),
    ).toEqual([]);
  });

  it("preserves root-relative source-unit offsets when rest-height evidence exists", () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.glb" },
      fbxFile: { name: "motion.bvh" },
    });
    clip.metadata = {
      restHipsHeight: 100,
      rootTranslationOrigin: "root-offset",
      rootTranslationSpace: "offset-source-units",
    };
    clip.tracks = [{
      bone: "hips",
      path: "translation",
      times: [0, 1],
      values: [0, 0, 0, 10, 20, 30],
    }];
    const bound = bindCanonicalTracksToTargetRest(clip, {
      bones: new Map([["hips", createRestTransform({
        worldPosition: new Vector3(0, 1, 0),
      })]]),
      restHipsHeight: 1,
    });

    expect(bound[0]?.values).toEqual([0, 1, 0, 0.1, 1.2, 0.3]);
  });

  it("filters unmapped and non-hips translations while using target rest-height fallback", () => {
    const clip = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.glb" },
      fbxFile: { name: "motion.glb" },
    });
    clip.metadata = { rootTranslationSpace: "offset-meters" };
    clip.tracks = [
      { bone: "head", path: "rotation", times: [0], values: [0, 0, 0, 1] },
      { bone: "leftHand", path: "translation", times: [0], values: [1, 2, 3] },
      { bone: "hips", path: "translation", times: [0], values: [1] },
    ];
    const hipsRest = createRestTransform({
      worldPosition: new Vector3(0, 2, 0),
    });
    const bound = bindCanonicalTracksToTargetRest(clip, {
      bones: new Map([
        ["leftHand", createRestTransform({})],
        ["hips", hipsRest],
      ]),
    });

    expect(bound).toEqual([
      {
        bone: "hips",
        path: "translation",
        times: [0],
        values: [1, 2, 0],
      },
    ]);
  });

  it("keeps quaternion signs continuous in rest and delta binding", () => {
    const alternatingIdentity = [0, 0, 0, 1, 0, 0, 0, -1];
    const boundRest = bindCanonicalRotationsToRest(
      alternatingIdentity,
      createRestTransform({}),
    );
    const boundDelta = bindCanonicalRotationDeltasToTargetLocal(
      alternatingIdentity,
    );
    for (const values of [boundRest, boundDelta]) {
      const first = new Quaternion().fromArray(values, 0);
      const second = new Quaternion().fromArray(values, 4);
      expect(first.dot(second)).toBeGreaterThan(0.999999);
      expect(second.w).toBeGreaterThan(0);
    }
    expect(
      bindCanonicalRotationDeltasToTargetLocal([0]).slice(0, 4),
    ).toEqual([0, 0, 0, 1]);
  });

  it("binds partial translation offsets with default and explicit target bases", () => {
    expect(bindCanonicalTranslationOffsetsToTargetLocal([1])).toEqual([
      1, 0, 0,
    ]);
    const quarterTurn = new Quaternion().setFromAxisAngle(
      Y_AXIS,
      Math.PI / 2,
    );
    const rotated = bindCanonicalTranslationOffsetsToTargetLocal(
      [1, 0, 0],
      quarterTurn,
      new Quaternion(),
      2,
    );
    expect(new Vector3(...rotated as [number, number, number]).distanceTo(
      new Vector3(0, 0, -2),
    )).toBeLessThan(1e-6);
  });

  it("applies profile axis correction and meter offsets without source-height scaling", () => {
    const correction = createCanonicalToTargetWorldCorrection(
      GENERIC_GLTF_HUMANOID_PROFILE,
    );
    expect(correction.angleTo(new Quaternion())).toBeGreaterThan(1);
    const bound = bindCanonicalHipsTranslationsToRest({
      rest: createRestTransform({ worldPosition: new Vector3(0, 1, 0) }),
      rootTranslationSpace: "offset-meters",
      targetRestHipsHeight: 2,
      values: [1],
      canonicalToTargetWorld: correction,
    });
    expect(bound).toHaveLength(3);
    expect(bound.every(Number.isFinite)).toBe(true);
    expect(bound[1]).toBeCloseTo(1, 6);
  });
});

function createRestTransform({
  parentWorldMatrix = new Matrix4(),
  parentWorldQuaternion = new Quaternion(),
  worldPosition = new Vector3(),
  worldQuaternion = new Quaternion(),
}: {
  parentWorldMatrix?: Matrix4;
  parentWorldQuaternion?: Quaternion;
  worldPosition?: Vector3;
  worldQuaternion?: Quaternion;
}): TargetBoneRestTransform {
  return {
    parentWorldMatrixInverse: parentWorldMatrix.clone().invert(),
    parentWorldQuaternionInverse: parentWorldQuaternion.clone().invert(),
    worldPosition,
    worldQuaternion,
  };
}
