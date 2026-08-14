import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AnimationClip,
  AnimationMixer,
  Object3D,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";
import { Document, WebIO, type Animation } from "@gltf-transform/core";
import { describe, expect, it, vi } from "vitest";
import { exportAnimatedRigGLB } from "@/export/rig-motion-gltf";
import { importRigMotionDocument } from "@/import/rig-motion-gltf";
import { retargetRiggedGLTF } from "@/pipelines/rigged-gltf";
import {
  inspectGLTFRig,
} from "@/rigs";
import { solveRigMotionToTarget } from "@/solvers";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

const FIXTURE_ROOT = path.resolve(
  "tests/fixtures/non-humanoid/mesh2motion",
);

describe("Mesh2Motion CC0 non-humanoid acceptance", () => {
  it("detects every active family with full required-chain coverage", async () => {
    const cases = [
      ["fox-animations.glb", "quadruped", "mesh2motion-fox"],
      ["bird-animations.glb", "avian", "mesh2motion-bird"],
      ["snake-animations.glb", "serpentine", "mesh2motion-snake"],
      ["spider-animations.glb", "arachnid", "mesh2motion-spider"],
      ["dragon-animations.glb", "creature", "mesh2motion-dragon"],
    ] as const;

    for (const [filename, family, profileId] of cases) {
      const inspection = inspectGLTFRig(await readDocument(filename));
      expect(inspection.definition.family, filename).toBe(family);
      expect(inspection.profile.id, filename).toBe(profileId);
      expect(inspection.missingRequiredRoles, filename).toEqual([]);
      expect(inspection.requiredChainCoverage, filename).toBe(1);
      expect(inspection.topologyConflicts, filename).toEqual([]);
      expect(inspection.axisWarnings, filename).toEqual([]);
    }
  });

  it("retargets the real Fox Idle, Walk, Run, and Jump action matrix to Fox, Dog, and Horse", async () => {
    const targets = ["fox-base.glb", "fox-dog.glb", "fox-horse.glb"];
    const actions = ["Idle", "Walk", "Run", "Jump"];

    for (const actionName of actions) {
      const source = await readDocument("fox-animations.glb");
      const action = source
        .getRoot()
        .listAnimations()
        .find((animation) => animation.getName() === actionName);
      expect(action, actionName).toBeDefined();
      const motion = importRigMotionDocument(
        documentWithAnimation(source, action!),
        `fox-${actionName.toLowerCase()}.glb`,
        { createdAt: "2026-08-13T00:00:00.000Z" },
      );

      for (const targetFilename of targets) {
        const target = inspectGLTFRig(await readDocument(targetFilename));
        const solved = solveRigMotionToTarget({
          motion,
          target,
          targetFilename,
        });
        expect(solved.diagnostics.mapping.requiredChainCoverage).toBe(1);
        expect(solved.diagnostics.mapping.topologyConflicts.target).toEqual([]);
        expect(solved.diagnostics.contacts.transferredRoles).toHaveLength(4);
        expect(solved.diagnostics.contacts.drift).toHaveLength(4);
        expect(solved.diagnostics.rootScale).toBeGreaterThan(0);
        expect(
          solved.diagnostics.loopBoundary.maxRotationDeltaDegrees,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("preserves rest input and exact signatures as identity for every family", async () => {
    const cases = [
      ["fox-animations.glb", "Rest Pose"],
      ["bird-animations.glb", "Rest Pose"],
      ["snake-animations.glb", "Rest Pose"],
      ["spider-animations.glb", "Rest Pose"],
      ["dragon-animations.glb", "Rest Pose"],
    ] as const;

    for (const [filename, actionName] of cases) {
      const source = await readDocument(filename);
      const action = source
        .getRoot()
        .listAnimations()
        .find((animation) => animation.getName() === actionName)!;
      const actionDocument = documentWithAnimation(source, action);
      const motion = importRigMotionDocument(actionDocument, filename, {
        createdAt: "2026-08-13T00:00:00.000Z",
      });
      const target = inspectGLTFRig(actionDocument);
      const solved = solveRigMotionToTarget({
        motion,
        target,
        targetFilename: filename,
      });
      expect(solved.diagnostics.solver.id, filename).toBe(
        "same-rest-node-skin-signature",
      );
      expect(solved.tracks, filename).toEqual(motion.tracks);
      expect(solved.restPose, filename).toEqual(target.restPose);
    }
  });

  it("runs family-specific solvers and blocks every cross-family pairing", async () => {
    const cases = [
      ["bird-animations.glb", "bird-eagle.glb", "avian", "definition-mapped-swing-twist-v1"],
      ["snake-animations.glb", "snake-animations.glb", "serpentine", "serpentine-chain-resample-v1"],
      ["spider-animations.glb", "spider-animations.glb", "arachnid", "definition-mapped-swing-twist-v1"],
      ["dragon-animations.glb", "dragon-animations.glb", "creature", "definition-mapped-swing-twist-v1"],
    ] as const;

    for (const [sourceName, targetName, family, solver] of cases) {
      const result = await retargetRiggedGLTF({
        motionFile: await readFileAsWebFile(sourceName),
        avatarFile: await createScaledTargetFile(targetName, 1.2),
        animationName: "Rest Pose",
      });
      expect(result.motion.family, sourceName).toBe(family);
      expect(result.solver, sourceName).toBe(solver);
      expect(result.motion.diagnostics.mapping.requiredChainCoverage).toBe(1);
    }

    const source = await readDocument("bird-animations.glb");
    const motion = importRigMotionDocument(source, "bird-animations.glb", {
      animationName: "Rest Pose",
    });
    for (const targetName of [
      "fox-base.glb",
      "snake-animations.glb",
      "spider-animations.glb",
      "dragon-animations.glb",
    ]) {
      const target = inspectGLTFRig(await readDocument(targetName));
      expect(() =>
        solveRigMotionToTarget({ motion, target, targetFilename: targetName }),
      ).toThrow(/Incompatible rigs.*family-mismatch/);
    }
  });

  it("resamples a 20-joint Mesh2Motion snake motion onto a shorter axial chain", async () => {
    const sourceDocument = await readDocument("snake-animations.glb");
    const motion = importRigMotionDocument(
      sourceDocument,
      "snake-animations.glb",
      { animationName: "Rest Pose" },
    );
    const target = inspectGLTFRig(createVariableSnakeTarget(8));
    expect(target.requiredChainCoverage).toBe(1);
    expect(target.missingRequiredRoles).toEqual([]);

    const solved = solveRigMotionToTarget({
      motion,
      target,
      targetFilename: "short-snake.glb",
    });
    expect(solved.diagnostics.solver.id).toBe("serpentine-chain-resample-v1");
    expect(solved.diagnostics.mapping.requiredChainCoverage).toBe(1);
    expect(
      solved.tracks.filter(
        (track) => track.path === "rotation" && track.role.startsWith("axial."),
      ),
    ).toHaveLength(8);
  });

  it("rejects Mesh2Motion unrigged meshes at the bounded rig inspection boundary", async () => {
    for (const filename of [
      "snake-target.glb",
      "spider-target.glb",
      "dragon-target.glb",
    ]) {
      await expect(
        readDocument(filename).then((document) => inspectGLTFRig(document)),
      ).rejects.toThrow(/No supported rig profile/);
    }
  });

  it("reloads and actually plays every family's exported Animated GLB in Three.js", async () => {
    const cases = [
      ["fox-animations.glb", "fox-dog.glb", false],
      ["bird-animations.glb", "bird-eagle.glb", false],
      ["snake-animations.glb", "snake-animations.glb", true],
      ["spider-animations.glb", "spider-animations.glb", true],
      ["dragon-animations.glb", "dragon-animations.glb", true],
    ] as const;
    for (const [sourceName, targetName, scaleTarget] of cases) {
      const avatarFile = scaleTarget
        ? await createScaledTargetFile(targetName, 1.15)
        : await readFileAsWebFile(targetName);
      const result = await retargetRiggedGLTF({
        motionFile: await readFileAsWebFile(sourceName),
        avatarFile,
        animationName: "Rest Pose",
      });
      const bytes = await exportAnimatedRigGLB({
        avatarFile,
        motion: result.motion,
      });
      const document = await new WebIO().readBinary(bytes);
      const animation = document.getRoot().listAnimations().at(-1);
      expect(animation?.listChannels(), sourceName).toHaveLength(
        result.motion.tracks.length,
      );
      const playback = playExportedDocument(document);
      expect(playback.advancedTracks, sourceName).toBeGreaterThan(0);
      expect(playback.hasRenderableMesh, sourceName).toBe(true);
    }
  });
});

async function readDocument(filename: string) {
  return new WebIO().readBinary(
    new Uint8Array(await readFile(path.join(FIXTURE_ROOT, filename))),
  );
}

async function readFileAsWebFile(filename: string) {
  const bytes = await readFile(path.join(FIXTURE_ROOT, filename));
  return new File([bytes], filename, { type: "model/gltf-binary" });
}

async function createScaledTargetFile(filename: string, scale: number) {
  const document = await readDocument(filename);
  for (const animation of document.getRoot().listAnimations()) {
    animation.dispose();
  }
  const joints = new Set(
    document.getRoot().listSkins().flatMap((skin) => skin.listJoints()),
  );
  for (const node of joints) {
    const translation = node.getTranslation();
    node.setTranslation([
      translation[0] * scale,
      translation[1] * scale,
      translation[2] * scale,
    ]);
  }
  const bytes = await new WebIO().writeBinary(document);
  return new File([bytes], `scaled-${filename}`, {
    type: "model/gltf-binary",
  });
}

function documentWithAnimation(
  source: Awaited<ReturnType<typeof readDocument>>,
  action: Animation,
) {
  for (const animation of source.getRoot().listAnimations()) {
    if (animation.getName() !== action.getName()) animation.dispose();
  }
  return source;
}

function playExportedDocument(
  document: Awaited<ReturnType<typeof readDocument>>,
) {
  const scene = new Object3D();
  const nodes = new Map(
    document.getRoot().listNodes().map((node) => {
      const object = new Object3D();
      object.name = node.getName();
      object.position.fromArray(node.getTranslation());
      object.quaternion.fromArray(node.getRotation());
      return [node, object] as const;
    }),
  );
  for (const [node, object] of nodes) {
    const parent = node.getParentNode();
    if (parent && nodes.has(parent)) nodes.get(parent)!.add(object);
    else scene.add(object);
  }
  const animation = document.getRoot().listAnimations().at(-1)!;
  const tracks = animation.listChannels().flatMap((channel) => {
    const node = channel.getTargetNode();
    const sampler = channel.getSampler();
    const input = sampler?.getInput()?.getArray();
    const output = sampler?.getOutput()?.getArray();
    const object = node ? nodes.get(node) : null;
    if (!object || !input || !output) return [];
    const path = channel.getTargetPath();
    const Track = path === "rotation"
      ? QuaternionKeyframeTrack
      : VectorKeyframeTrack;
    return [new Track(`${object.uuid}.${path === "rotation" ? "quaternion" : "position"}`, input, output)];
  });
  const clip = new AnimationClip("exported", -1, tracks);
  const before = new Map(
    [...nodes.values()].map((object) => [
      object,
      [...object.position.toArray(), ...object.quaternion.toArray()],
    ]),
  );
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(clip).play();
  mixer.update(Math.max(clip.duration * 0.37, 1 / 30));
  const advancedTracks = [...nodes.values()].filter((object) => {
    const start = before.get(object)!;
    const current = [...object.position.toArray(), ...object.quaternion.toArray()];
    return current.some((value, index) => Math.abs(value - (start[index] ?? 0)) > 1e-6);
  }).length;
  mixer.stopAllAction();
  return {
    advancedTracks,
    hasRenderableMesh: document.getRoot().listMeshes().length > 0,
  };
}

function createVariableSnakeTarget(segmentCount: number) {
  const document = new Document();
  const scene = document.createScene("short snake");
  document.getRoot().setDefaultScene(scene);
  const root = document.createNode("root");
  const head = document.createNode("head").setTranslation([0, 0, -0.2]);
  const neck = document.createNode("neck").setTranslation([0, 0, -0.15]);
  scene.addChild(root);
  root.addChild(head);
  head.addChild(neck);
  let parent = neck;
  for (let index = 0; index < segmentCount; index += 1) {
    const node = document
      .createNode(`tail${String(index + 1).padStart(2, "0")}`)
      .setTranslation([0, 0, -0.12]);
    parent.addChild(node);
    parent = node;
  }
  return document;
}
