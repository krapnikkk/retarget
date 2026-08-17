import { Document } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  bindCanonicalClipToGLTFTarget,
  createGLTFHumanoidRigSignature,
} from "@/export/gltf-target-binding";
import { bindCanonicalClipToRawGLTFTarget } from "@/export/raw-gltf-target-binding";
import { GENERIC_GLTF_HUMANOID_PROFILE } from "@/profiles";
import {
  bindSolvedMotionClipStub,
  createRetargetedMotionClipStub,
} from "../fixtures/retarget-stub";
import { CANONICAL_AXIS_FRAME, createAxisCorrection } from "@/retarget/coordinate-space";
import { solveHumanoidCustomRigMotion } from "@/solvers";

describe("glTF target binding", () => {
  it("writes target-local tracks from canonical world deltas and target rest transforms", () => {
    const document = new Document();
    const scene = document.createScene("scene");
    const parentRotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      -Math.PI / 2,
    );
    const localRestRotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      0.2,
    );
    const parent = document
      .createNode("Armature")
      .setRotation(parentRotation.toArray());
    const hips = document
      .createNode("hips")
      .setTranslation([0, 0, 0.9])
      .setRotation(localRestRotation.toArray());
    scene.addChild(parent);
    parent.addChild(hips);

    const canonical = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.glb" },
      fbxFile: { name: "motion.fbx" },
    });
    const canonicalRotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      0.35,
    );
    const nodesByBone = new Map([["hips" as const, hips]]);
    const clip = bindSolvedMotionClipStub(
      solveHumanoidCustomRigMotion(canonical),
      {
        profile: GENERIC_GLTF_HUMANOID_PROFILE.id,
        rigSignature: createGLTFHumanoidRigSignature(
          nodesByBone,
          GENERIC_GLTF_HUMANOID_PROFILE.id,
        ),
      },
    );
    clip.metadata = {
      normalizationVersion: 1,
      canonicalProfile: "vrm-humanoid",
      rootTranslationSpace: "offset-meters",
      restHipsHeight: 0.9,
    };
    clip.tracks = [
      {
        bone: "hips",
        path: "translation",
        times: [0],
        values: [0, 0, 0.25],
      },
      {
        bone: "hips",
        path: "rotation",
        times: [0],
        values: canonicalRotation.toArray(),
      },
    ];

    const bound = bindCanonicalClipToGLTFTarget(
      clip,
      nodesByBone,
      GENERIC_GLTF_HUMANOID_PROFILE,
    );
    const translation = bound.tracks.find((track) => track.path === "translation")!;
    const rotation = bound.tracks.find((track) => track.path === "rotation")!;
    const parentWorldMatrix = new Matrix4().fromArray(parent.getWorldMatrix());
    const reboundWorldPosition = new Vector3(...translation.values).applyMatrix4(
      parentWorldMatrix,
    );
    const targetRestWorldPosition = new Vector3(...hips.getWorldTranslation());
    const canonicalToTarget = createAxisCorrection(
      CANONICAL_AXIS_FRAME,
      GENERIC_GLTF_HUMANOID_PROFILE,
    );
    const expectedWorldPosition = new Vector3(0, 0, 0.25)
      .applyQuaternion(canonicalToTarget)
      .add(targetRestWorldPosition);
    expect(reboundWorldPosition.distanceTo(expectedWorldPosition)).toBeLessThan(1e-6);

    const targetWorldDelta = new Quaternion(...rotation.values)
      .premultiply(parentRotation)
      .multiply(
        new Quaternion(...hips.getWorldRotation()).invert(),
      );
    const canonicalRoundTrip = targetWorldDelta
      .premultiply(canonicalToTarget.clone().invert())
      .multiply(canonicalToTarget);
    expect(canonicalRoundTrip.angleTo(canonicalRotation)).toBeLessThan(1e-6);

    const rawBound = bindCanonicalClipToRawGLTFTarget(
      clip,
      [
        {
          name: "Armature",
          rotation: parentRotation.toArray(),
          children: [1],
        },
        {
          name: "hips",
          translation: [0, 0, 0.9],
          rotation: localRestRotation.toArray(),
        },
      ],
      new Map([["hips", 1]]),
      GENERIC_GLTF_HUMANOID_PROFILE,
    );
    rawBound.tracks.forEach((track, index) => {
      expect(track.bone).toBe(bound.tracks[index]?.bone);
      expect(track.path).toBe(bound.tracks[index]?.path);
      track.values.forEach((value, valueIndex) => {
        expect(value).toBeCloseTo(bound.tracks[index]!.values[valueIndex]!, 6);
      });
    });
  });

  it("rejects cyclic raw glTF parent graphs before walking ancestors", () => {
    const canonical = createRetargetedMotionClipStub({
      vrmFile: { name: "avatar.glb" },
      fbxFile: { name: "motion.fbx" },
    });
    const clip = bindSolvedMotionClipStub(
      solveHumanoidCustomRigMotion(canonical),
    );
    expect(() =>
      bindCanonicalClipToRawGLTFTarget(
        clip,
        [
          { name: "hips", children: [1] },
          { name: "spine", children: [0] },
        ],
        new Map([["hips", 0]]),
        GENERIC_GLTF_HUMANOID_PROFILE,
      ),
    ).toThrow(/cycle detected/i);
  });
});
