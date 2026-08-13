import { Accessor, Document, type Node } from "@gltf-transform/core";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createRetargetedMotionClipStub } from "../fixtures/retarget-stub";
import {
  DEFAULT_SEMANTIC_THRESHOLDS,
  solveSemanticWorldPose,
  validateGLTFWorldSemantics,
  validateHumanoidMotionSemantics,
  type HumanoidSemanticRestPose,
} from "@/validation";

describe("semantic motion validation", () => {
  it("compares rotations, root displacement, hands, and feet at fixed samples", () => {
    const expected = createClip();
    const actual = structuredClone(expected);
    const passed = validateHumanoidMotionSemantics({
      actual,
      expected,
      restPose: createRestPose(),
    });

    expect(passed).toMatchObject({
      level: "semantic",
      ok: true,
      metrics: {
        durationErrorSeconds: 0,
        maxRotationErrorDegrees: 0,
        maxRootDisplacementErrorMeters: 0,
        maxRootDirectionErrorDegrees: 0,
        maxEndEffectorErrorMeters: 0,
        maxSymmetryErrorMeters: 0,
      },
    });
    expect(passed.sampleTimes).toEqual(
      expect.arrayContaining([0, 0.25, 0.5, 0.75, 1]),
    );
    expect(passed.sampleTimes.length).toBeGreaterThan(5);

    const drifted = structuredClone(expected);
    drifted.tracks.find(
      (track) => track.bone === "leftUpperArm" && track.path === "rotation",
    )!.values.splice(
      4,
      4,
      ...new Quaternion()
        .setFromAxisAngle(new Vector3(0, 0, 1), 0.25)
        .toArray(),
    );
    drifted.tracks.find(
      (track) => track.bone === "hips" && track.path === "translation",
    )!.values.splice(3, 3, 0.1, 0, -1);
    const failed = validateHumanoidMotionSemantics({
      actual: drifted,
      expected,
      restPose: createRestPose(),
    });

    expect(failed.ok).toBe(false);
    expect(failed.metrics.maxRotationErrorDegrees).toBeGreaterThan(10);
    expect(failed.metrics.maxRootDisplacementErrorMeters).toBeCloseTo(0.1, 6);
    expect(failed.metrics.maxEndEffectorErrorMeters).toBeGreaterThan(0.1);
  });

  it("refuses meter-based root certification for unknown source units", () => {
    const expected = createClip();
    expected.metadata!.rootTranslationSpace = "offset-source-units";
    const result = validateHumanoidMotionSemantics({
      actual: structuredClone(expected),
      expected,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      "root displacement cannot be certified without meter-normalized tracks",
    );
  });

  it("propagates ancestor rotations through the complete FK chain", () => {
    const expected = createClip();
    const actual = createClip();
    expected.tracks = [rotationTrack("hips", Math.PI / 2)];
    actual.tracks = [rotationTrack("hips", 0)];
    const restPose = new Map([
      ["hips", restBone([0, 0, 0])],
      ["spine", restBone([0, 1, 0], "hips")],
      ["chest", restBone([0, 2, 0], "spine")],
      ["leftHand", restBone([1, 2, 0], "chest")],
    ]) satisfies HumanoidSemanticRestPose;

    const result = validateHumanoidMotionSemantics({
      actual,
      expected,
      endEffectors: ["leftHand"],
      restPose,
      rotationBones: [],
    });

    expect(result.ok).toBe(false);
    expect(result.metrics.maxEndEffectorErrorMeters).toBeGreaterThan(2);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/end-effector error/i)]),
    );
  });

  it("reconstructs local rest transforms from world rotation and scale", () => {
    const quarterTurn = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
      .toArray() as [number, number, number, number];
    const restPose = new Map([
      [
        "hips",
        {
          ...restBone([0, 0, 0]),
          worldQuaternion: quarterTurn,
          worldScale: [2, 2, 2] as [number, number, number],
        },
      ],
      [
        "leftHand",
        {
          ...restBone([-2, 0, 0], "hips"),
          worldQuaternion: quarterTurn,
          worldScale: [2, 2, 2] as [number, number, number],
        },
      ],
    ]) satisfies HumanoidSemanticRestPose;
    const clip = createClip();
    clip.tracks = [];

    const world = solveSemanticWorldPose({ clip, restPose, time: 0 });
    expect(world.get("leftHand")?.position.toArray()).toEqual([-2, 0, 0]);
    expect(world.get("leftHand")?.quaternion.angleTo(new Quaternion(...quarterTurn)))
      .toBeLessThan(1e-8);
  });

  it("compares exported glTF world poses without round-tripping through the importer", () => {
    const expected = createClip();
    expected.tracks = [rotationTrack("hips", Math.PI / 2)];
    const { document, nodesByBone } = createIncorrectAnimatedDocument(
      expected.name,
    );

    const result = validateGLTFWorldSemantics({
      animationName: expected.name,
      document,
      expected,
      nodesByBone,
      thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    });

    expect(result.ok).toBe(false);
    expect(result.metrics.maxRotationErrorDegrees).toBeCloseTo(90, 4);
    expect(result.metrics.maxEndEffectorErrorMeters).toBeGreaterThan(2);
  });
});

function createIncorrectAnimatedDocument(animationName: string) {
  const document = new Document();
  const scene = document.createScene("oracle");
  document.getRoot().setDefaultScene(scene);
  const hips = document.createNode("hips");
  const spine = document.createNode("spine").setTranslation([0, 1, 0]);
  const chest = document.createNode("chest").setTranslation([0, 1, 0]);
  const leftHand = document
    .createNode("leftHand")
    .setTranslation([1, 0, 0]);
  scene.addChild(hips);
  hips.addChild(spine);
  spine.addChild(chest);
  chest.addChild(leftHand);
  const buffer = document.createBuffer("animation");
  const input = document
    .createAccessor("time")
    .setArray(new Float32Array([0, 1]))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const output = document
    .createAccessor("incorrect-hips-rotation")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]))
    .setType(Accessor.Type.VEC4)
    .setBuffer(buffer);
  const sampler = document
    .createAnimationSampler("hips.rotation")
    .setInput(input)
    .setOutput(output)
    .setInterpolation("LINEAR");
  const channel = document
    .createAnimationChannel("hips.rotation")
    .setTargetNode(hips)
    .setTargetPath("rotation")
    .setSampler(sampler);
  document
    .createAnimation(animationName)
    .addSampler(sampler)
    .addChannel(channel);
  return {
    document,
    nodesByBone: new Map([
      ["hips", hips],
      ["spine", spine],
      ["chest", chest],
      ["leftHand", leftHand],
    ]) as ReadonlyMap<"hips" | "spine" | "chest" | "leftHand", Node>,
  };
}

function rotationTrack(bone: "hips", angle: number) {
  const rotation = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 0, 1), angle)
    .toArray();
  return {
    bone,
    path: "rotation" as const,
    times: [0, 1],
    values: [0, 0, 0, 1, ...rotation],
  };
}

function restBone(
  worldPosition: [number, number, number],
  parent?: "hips" | "spine" | "chest",
) {
  return {
    ...(parent ? { parent } : {}),
    worldPosition,
    worldQuaternion: [0, 0, 0, 1] as [number, number, number, number],
  };
}

function createClip() {
  const clip = createRetargetedMotionClipStub({
    vrmFile: { name: "avatar.glb" },
    fbxFile: { name: "motion.glb" },
  });
  clip.duration = 1;
  clip.metadata = {
    rootTranslationSpace: "offset-meters",
    restHipsHeight: 1,
  };
  clip.tracks = [
    {
      bone: "hips",
      path: "translation",
      times: [0, 1],
      values: [0, 0, 0, 0, 0, -1],
    },
    {
      bone: "leftUpperArm",
      path: "rotation",
      times: [0, 1],
      values: [0, 0, 0, 1, 0, 0, 0, 1],
    },
  ];
  return clip;
}

function createRestPose(): HumanoidSemanticRestPose {
  return new Map([
    [
      "hips",
      {
        worldPosition: [0, 1, 0],
        worldQuaternion: [0, 0, 0, 1],
      },
    ],
    [
      "leftUpperArm",
      {
        parent: "hips",
        worldPosition: [0.3, 1.5, 0],
        worldQuaternion: [0, 0, 0, 1],
      },
    ],
    [
      "leftHand",
      {
        parent: "leftUpperArm",
        worldPosition: [0.8, 1.5, 0],
        worldQuaternion: [0, 0, 0, 1],
      },
    ],
    [
      "rightHand",
      {
        parent: "hips",
        worldPosition: [-0.8, 1.5, 0],
        worldQuaternion: [0, 0, 0, 1],
      },
    ],
    [
      "leftFoot",
      {
        parent: "hips",
        worldPosition: [0.2, 0, 0],
        worldQuaternion: [0, 0, 0, 1],
      },
    ],
    [
      "rightFoot",
      {
        parent: "hips",
        worldPosition: [-0.2, 0, 0],
        worldQuaternion: [0, 0, 0, 1],
      },
    ],
  ]);
}
