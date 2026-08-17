import { Accessor, Document, WebIO, type Node } from "@gltf-transform/core";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  QUADRUPED_RIG_DEFINITION,
  HUMANOID_RIG_DEFINITION,
  createDefaultRigRecipe,
  getRigCompatibility,
  inspectGLTFRig,
  parseRigRecipe,
  serializeRigRecipe,
  getRigOutputCapabilities,
} from "@/rigs";
import {
  parseRigMotion,
  serializeRigMotion,
  validateRigMotion,
} from "@/rig-motion";
import {
  importRigMotionDocument,
  listRigMotionActions,
} from "@/import/rig-motion-gltf";
import { solveRigMotionToTarget } from "@/solvers";
import {
  exportAnimatedRigGLB,
  exportRigMotionGLTF,
  validateRigMotionGLTFReload,
} from "@/export/rig-motion-gltf";
import {
  exportAnimatedRigGLBStream,
  validateAnimatedRigGLBStream,
} from "@/export/streamed-avatar-glb";
import { retargetRiggedGLTF } from "@/pipelines/rigged-gltf";
import { loadSemanticAvatarRig } from "@/browser/semantic-rig";
import { normalizeRigNodeName } from "@/rigs/gltf-inspection";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

describe("non-humanoid quadruped contract", () => {
  it("preserves non-ASCII rig names after Unicode normalization", () => {
    expect(normalizeRigNodeName("左 腕")).toBe("左腕");
    expect(normalizeRigNodeName("ＭｉｘａｍｏＲｉｇ：Hips")).toBe("hips");
  });

  it("keeps rig family, definition, and recipe compatibility explicit", () => {
    expect(
      getRigCompatibility(
        { rigFamily: "quadruped", rigDefinitionId: "quadruped-v1" },
        { rigFamily: "humanoid", rigDefinitionId: "humanoid-v1" },
      ),
    ).toEqual({ compatible: false, reason: "family-mismatch" });

    const recipe = createDefaultRigRecipe({
      family: "quadruped",
      rigDefinitionId: "quadruped-v1",
    });
    expect(parseRigRecipe(serializeRigRecipe(recipe))).toEqual(recipe);
    expect(getRigOutputCapabilities("quadruped-v1")).toEqual([
      "rig-motion-json-v2",
      "gltf-animation",
      "animated-glb",
    ]);
  });

  it("detects canonical quadruped roles and rejects missing required roles", () => {
    const complete = inspectGLTFRig(createQuadrupedDocument());
    expect(complete.definition.id).toBe("quadruped-v1");
    expect(complete.profile.id).toBe("canonical-quadruped-v1");
    expect(complete.missingRequiredRoles).toEqual([]);
    expect(complete.requiredChainCoverage).toBe(1);
    expect(complete.definition.contactRoles).toHaveLength(4);

    const incomplete = inspectGLTFRig(
      createQuadrupedDocument({ omit: "frontLeft.paw" }),
    );
    expect(incomplete.missingRequiredRoles).toContain("frontLeft.paw");
    expect(incomplete.requiredChainCoverage).toBeLessThan(1);

    const optionalTailMissing = inspectGLTFRig(
      createQuadrupedDocument({ omit: "tail.4" }),
    );
    expect(optionalTailMissing.missingRequiredRoles).toEqual([]);
    expect(optionalTailMissing.requiredChainCoverage).toBe(1);
  });

  it("binds the rig signature to node scale and skin-relevant rest evidence", () => {
    const baseline = inspectGLTFRig(createQuadrupedDocument());
    const scaledDocument = createQuadrupedDocument();
    scaledDocument
      .getRoot()
      .listNodes()
      .find((node) => node.getName() === "frontLeft.upper")!
      .setScale([1, 1, 1.000001]);
    const scaled = inspectGLTFRig(scaledDocument);

    expect(baseline.signature).toMatch(
      /^quadruped-v1:rest-node-skin-v3:sha256:[0-9a-f]{64}$/,
    );
    expect(scaled.signature).not.toBe(baseline.signature);
  });

  it("round-trips Rig Motion JSON v2 without changing Humanoid v1", () => {
    const motion = importRigMotionDocument(
      createQuadrupedDocument({ animated: true }),
      "quadruped-motion.glb",
    );
    expect(motion.schemaVersion).toBe(2);
    expect(motion.family).toBe("quadruped");
    expect(motion.rigDefinitionId).toBe("quadruped-v1");
    expect(parseRigMotion(serializeRigMotion(motion))).toEqual(motion);

    const invalid = structuredClone(motion);
    invalid.tracks.push({
      role: "frontLeft.upper",
      path: "translation",
      times: [0, 1],
      values: [0, 0, 0, 0, 0, 0],
    });
    expect(validateRigMotion(invalid)).toMatchObject({ ok: false });
  });

  it("requires an explicit action for multi-animation glTF inputs", () => {
    const document = createQuadrupedDocument({
      actionNames: ["Idle", "Run"],
    });
    expect(listRigMotionActions(document)).toEqual([
      { index: 0, name: "Idle" },
      { index: 1, name: "Run" },
    ]);
    expect(() => importRigMotionDocument(document, "actions.glb")).toThrow(
      /select animationName or animationIndex explicitly/,
    );

    const motion = importRigMotionDocument(document, "actions.glb", {
      animationName: "Run",
    });
    expect(motion.source.animation).toMatchObject({ index: 1, name: "Run" });
    expect(() =>
      importRigMotionDocument(document, "actions.glb", {
        animationIndex: 0,
        animationName: "Run",
      }),
    ).toThrow(/select different actions/);
  });

  it("reads and bounded-resamples non-humanoid CUBICSPLINE tracks", () => {
    const document = createQuadrupedDocument({ animated: true });
    convertRootTranslationToCubic(document);
    const motion = importRigMotionDocument(document, "spline.glb");
    const root = motion.tracks.find(
      (track) => track.role === "root" && track.path === "translation",
    );

    expect(motion.source.animation).toEqual({
      index: 0,
      name: "walk",
      interpolationModes: ["CUBICSPLINE", "LINEAR"],
      resampledTracks: 1,
    });
    expect(root!.times.length).toBeGreaterThan(2);
    expect(root!.times.length).toBeLessThan(61);
    expect(root?.values.slice(0, 3)).toEqual([0, 0, 0]);
    expect(root?.values.slice(-3)).toEqual([0, 0, 2]);
    const midpoint = root!.times.indexOf(0.5);
    expect(root?.values[midpoint * 3 + 2]).toBeCloseTo(1, 5);
  });

  it("uses the same rest-node-skin signature path when source and target signatures match", () => {
    const sourceDocument = createQuadrupedDocument({ animated: true });
    const motion = importRigMotionDocument(sourceDocument, "walk.glb");
    const target = inspectGLTFRig(sourceDocument);
    const solved = solveRigMotionToTarget({
      motion,
      target,
      targetFilename: "same.glb",
    });

    expect(solved.diagnostics.solver.id).toBe("same-rest-node-skin-signature");
    expect(solved.diagnostics.rootScale).toBe(1);
    expect(solved.tracks).toEqual(motion.tracks);
    expect(solved.diagnostics.contacts.transferredRoles).toEqual(
      QUADRUPED_RIG_DEFINITION.contactRoles,
    );
    expect(solved.diagnostics.contacts.drift).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ space: "world" }),
      ]),
    );
  });

  it("does not trust a matching hash without matching stable node identity", () => {
    const sourceDocument = createQuadrupedDocument({ animated: true });
    const motion = importRigMotionDocument(sourceDocument, "walk.glb");
    const target = inspectGLTFRig(sourceDocument);
    const root = motion.restPose.find((transform) => transform.role === "root")!;
    root.nodeIdentity = {
      ...root.nodeIdentity!,
      nodeIndex: root.nodeIdentity!.nodeIndex + 1,
    };

    const solved = solveRigMotionToTarget({
      motion,
      target,
      targetFilename: "same-hash-different-node.glb",
    });

    expect(solved.diagnostics.solver.id).toBe(
      "definition-mapped-swing-twist-v1",
    );
  });

  it("includes root translation in world-space contact drift", () => {
    const sourceDocument = createQuadrupedDocument({ animated: true });
    const motion = importRigMotionDocument(sourceDocument, "walk.glb");
    motion.tracks = motion.tracks.filter(
      (track) => track.role === "root" && track.path === "translation",
    );
    const solved = solveRigMotionToTarget({
      motion,
      target: inspectGLTFRig(sourceDocument),
      targetFilename: "same.glb",
    });

    expect(solved.diagnostics.contacts.drift).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          space: "world",
          sampledFrames: 2,
          groundedFrames: 2,
          maxGroundedDrift: 1,
        }),
      ]),
    );
  });

  it("hard-blocks a humanoid target before any quadruped best-effort solve", () => {
    const motion = importRigMotionDocument(
      createQuadrupedDocument({ animated: true }),
      "walk.glb",
    );
    const target = inspectGLTFRig(createHumanoidRigDocument());
    expect(() =>
      solveRigMotionToTarget({
        motion,
        target,
        targetFilename: "human.glb",
      }),
    ).toThrow(/Incompatible rigs.*family-mismatch/);
  });

  it("reports required-role and topology failures at their source or target boundary", () => {
    const motion = importRigMotionDocument(
      createQuadrupedDocument({ animated: true }),
      "walk.glb",
    );
    const target = inspectGLTFRig(createQuadrupedDocument({ scale: 1.1 }));

    const sourceMissing = structuredClone(motion);
    sourceMissing.restPose = sourceMissing.restPose.filter(
      (transform) => transform.role !== "frontLeft.paw",
    );
    sourceMissing.restPose.find(
      (transform) => transform.role === "frontLeft.toes",
    )!.parentRole = "frontLeft.ankle";
    expect(() =>
      solveRigMotionToTarget({
        motion: sourceMissing,
        target,
        targetFilename: "target.glb",
      }),
    ).toThrow(/Missing required source roles: frontLeft\.paw/);

    expect(() =>
      solveRigMotionToTarget({
        motion,
        target: { ...target, missingRequiredRoles: ["frontRight.paw"] },
        targetFilename: "target.glb",
      }),
    ).toThrow(/Missing required target roles: frontRight\.paw/);

    const sourceConflict = structuredClone(motion);
    sourceConflict.source.topologyConflicts = [{ role: "spine" }];
    expect(() =>
      solveRigMotionToTarget({
        motion: sourceConflict,
        target,
        targetFilename: "target.glb",
      }),
    ).toThrow(/Source topology conflicts: spine/);

    expect(() =>
      solveRigMotionToTarget({
        motion,
        target: { ...target, topologyConflicts: [{ role: "neck" }] },
        targetFilename: "target.glb",
      }),
    ).toThrow(/Target topology conflicts: neck/);
  });

  it("preserves optional-role and local-axis diagnostics on a successful solve", () => {
    const motion = importRigMotionDocument(
      createQuadrupedDocument({ animated: true }),
      "walk.glb",
    );
    motion.restPose = motion.restPose.filter(
      (transform) => transform.role !== "tail.3",
    );
    motion.restPose.find(
      (transform) => transform.role === "tail.4",
    )!.parentRole = "tail.2";
    motion.source.axisWarnings = ["tail.3"];
    const inspectedTarget = inspectGLTFRig(
      createQuadrupedDocument({ omit: "tail.4", scale: 1.2 }),
    );
    const solved = solveRigMotionToTarget({
      motion,
      target: { ...inspectedTarget, axisWarnings: ["tail.4"] },
      targetFilename: "short-tail.glb",
    });

    expect(solved.diagnostics.warnings).toEqual([
      "Optional source roles missing: tail.3.",
      "Optional target roles missing: tail.4, tail.5.",
      "Source roles without a usable local primary axis: tail.3.",
      "Target roles without a usable local primary axis: tail.4.",
    ]);
  });

  it("handles singular twist decomposition, absent axes, and quaternion sign continuity", () => {
    const motion = importRigMotionDocument(
      createQuadrupedDocument({ animated: true }),
      "walk.glb",
    );
    const upperRest = motion.restPose.find(
      (transform) => transform.role === "frontLeft.upper",
    )!;
    const axis = new Vector3(...upperRest.primaryAxis!).normalize();
    const perpendicular = new Vector3(1, 0, 0);
    if (Math.abs(perpendicular.dot(axis)) > 0.9) perpendicular.set(0, 1, 0);
    perpendicular.cross(axis).normalize();
    const sourceRest = new Quaternion(...upperRest.rotation);
    const singularDelta = new Quaternion().setFromAxisAngle(
      perpendicular,
      Math.PI,
    );
    const singularAnimated = sourceRest.clone().multiply(singularDelta);
    const upperTrack = motion.tracks.find(
      (track) =>
        track.role === "frontLeft.upper" && track.path === "rotation",
    )!;
    upperTrack.times = [0, 0.33, 0.66, 1];
    upperTrack.values = [
      ...sourceRest.toArray(),
      ...singularAnimated.toArray(),
      ...sourceRest.toArray(),
      ...sourceRest.toArray().map((value) => -value),
    ];
    const axislessSource = motion.restPose.find(
      (transform) => transform.role === "head",
    )!;
    axislessSource.primaryAxis = [0, 0, 0];

    const target = inspectGLTFRig(
      createQuadrupedDocument({ restTwist: 0.15, scale: 1.15 }),
    );
    const targetRestPose = target.restPose.map((transform) =>
      transform.role === "head"
        ? { ...transform, primaryAxis: undefined }
        : transform,
    );
    const solved = solveRigMotionToTarget({
      motion,
      target: { ...target, restPose: targetRestPose },
      targetFilename: "axis-variant.glb",
    });
    const boundUpper = solved.tracks.find(
      (track) =>
        track.role === "frontLeft.upper" && track.path === "rotation",
    )!;

    expect(boundUpper.values.every(Number.isFinite)).toBe(true);
    for (let index = 4; index < boundUpper.values.length; index += 4) {
      const previous = new Quaternion().fromArray(boundUpper.values, index - 4);
      const current = new Quaternion().fromArray(boundUpper.values, index);
      expect(previous.dot(current)).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("transfers quadruped swing/twist and root scale across proportions", () => {
    const motion = importRigMotionDocument(
      createQuadrupedDocument({ animated: true }),
      "walk.glb",
    );
    const target = inspectGLTFRig(
      createQuadrupedDocument({ scale: 1.75, restTwist: 0.2 }),
    );
    const solved = solveRigMotionToTarget({
      motion,
      target,
      targetFilename: "large-dog.glb",
    });

    expect(solved.diagnostics.solver.id).toBe(
      "definition-mapped-swing-twist-v1",
    );
    expect(solved.diagnostics.rootScale).toBeCloseTo(1.75, 5);
    expect(solved.diagnostics.mapping.requiredChainCoverage).toBe(1);
    expect(solved.tracks).not.toEqual(motion.tracks);
    const firstUpperRotation = solved.tracks.find(
      (track) =>
        track.role === "frontLeft.upper" && track.path === "rotation",
    );
    const targetUpperRest = target.restPose.find(
      (transform) => transform.role === "frontLeft.upper",
    )!;
    const firstUpperValues = firstUpperRotation?.values.slice(0, 4) ?? [];
    expect(firstUpperValues).toHaveLength(4);
    firstUpperValues.forEach((value, index) => {
      expect(value).toBeCloseTo(targetUpperRest.rotation[index] ?? 0, 12);
    });
    const root = solved.tracks.find(
      (track) => track.role === "root" && track.path === "translation",
    );
    expect(root?.values.at(-1)).toBeCloseTo(1.75, 5);
  });

  it("runs the glTF pair pipeline and reloads both supported glTF outputs", async () => {
    const sourceBytes = await writeDocument(
      createQuadrupedDocument({ animated: true }),
    );
    const targetBytes = await writeDocument(
      createQuadrupedDocument({ embeddedGeometry: true, scale: 1.25 }),
    );
    const motionFile = createFile(sourceBytes, "fox-walk.glb");
    const avatarFile = createFile(targetBytes, "wolf.glb");
    const result = await retargetRiggedGLTF({ motionFile, avatarFile });

    expect(result.solver).toBe("definition-mapped-swing-twist-v1");
    expect(result.motion.target.filename).toBe("wolf.glb");
    expect(result.sourceInspection).not.toHaveProperty("nodesByRole");
    expect(result.targetInspection).not.toHaveProperty("nodesByRole");
    expect(result.motion.diagnostics.target.mappedRoles).toBe(
      result.targetInspection.restPose.length,
    );

    const animationBytes = await exportRigMotionGLTF(result.motion);
    const animationValidation = await validateRigMotionGLTFReload(
      animationBytes,
      result.motion,
    );
    expect(animationValidation).toMatchObject({
      ok: true,
      semantic: { ok: true, level: "semantic", issues: [] },
    });
    const animationDocument = await new WebIO().readBinary(animationBytes);
    expect(animationDocument.getRoot().listAnimations()).toHaveLength(1);
    expect(
      animationDocument.getRoot().listAnimations()[0].listChannels().length,
    ).toBe(result.motion.tracks.length);

    const animatedBytes = await exportAnimatedRigGLB({
      avatarFile,
      motion: result.motion,
    });
    const animatedValidation = await validateRigMotionGLTFReload(
      animatedBytes,
      result.motion,
    );
    expect(animatedValidation).toMatchObject({
      ok: true,
      semantic: { ok: true, level: "semantic", issues: [] },
    });
    const animatedDocument = await new WebIO().readBinary(animatedBytes);
    expect(animatedDocument.getRoot().listAnimations()).toHaveLength(1);
    expect(
      animatedDocument.getRoot().listAnimations()[0].listChannels().length,
    ).toBe(result.motion.tracks.length);

    const streamedBlob = await exportAnimatedRigGLBStream({
      avatarFile,
      motion: result.motion,
      expectedRigSignature: result.motion.target.rigSignature,
    });
    const streamedValidation = await validateAnimatedRigGLBStream(
      streamedBlob,
      result.motion,
    );
    expect(streamedValidation).toMatchObject({
      ok: true,
      executionMode: "streamed",
      semantic: { ok: true, level: "semantic", issues: [] },
    });

    const corruptedChannel = animationDocument
      .getRoot()
      .listAnimations()[0]!
      .listChannels()
      .find(
        (channel) =>
          channel.getTargetNode()?.getName() === "frontLeft.upper" &&
          channel.getTargetPath() === "rotation",
      )!;
    const corruptedOutput = corruptedChannel.getSampler()!.getOutput()!;
    corruptedOutput.setElement(corruptedOutput.getCount() - 1, [0, 1, 0, 0]);
    const corruptedBytes = await new WebIO().writeBinary(animationDocument);
    const corruptedValidation = await validateRigMotionGLTFReload(
      corruptedBytes,
      result.motion,
    );
    expect(corruptedValidation).toMatchObject({
      ok: true,
      semantic: { ok: false },
    });
    if (corruptedValidation.ok) {
      expect(corruptedValidation.semantic.metrics.maxRotationErrorDegrees).toBeGreaterThan(
        10,
      );
    }
  });

  it("keeps streamed channels bound to stable node indices when names repeat", async () => {
    const sourceBytes = await writeDocument(
      createQuadrupedDocument({ animated: true }),
    );
    const targetBytes = await writeDocument(
      createQuadrupedDocument({ duplicateRootName: true, embeddedGeometry: true }),
    );
    const avatarFile = createFile(targetBytes, "duplicate-root.glb");
    const result = await retargetRiggedGLTF({
      motionFile: createFile(sourceBytes, "walk.glb"),
      avatarFile,
    });
    const output = await exportAnimatedRigGLBStream({
      avatarFile,
      motion: result.motion,
      expectedRigSignature: result.motion.target.rigSignature,
    });
    const outputDocument = await new WebIO().readBinary(
      new Uint8Array(await output.arrayBuffer()),
    );
    const rootIdentity = result.targetInspection.restPose.find(
      (transform) => transform.role === "root",
    )!.nodeIdentity!;
    const rootChannel = outputDocument.getRoot().listAnimations().at(-1)!
      .listChannels()
      .find((channel) =>
        channel.getTargetPath() === "translation" &&
        channel.getTargetNode() === outputDocument.getRoot().listNodes()[rootIdentity.nodeIndex]
      );

    expect(rootChannel).toBeDefined();
    expect(rootChannel!.getTargetNode()!.listChildren().length).toBeGreaterThan(0);
  });

  it("maps browser scene roles by glTF node index when names repeat", async () => {
    const bytes = await writeDocument(
      createQuadrupedDocument({ duplicateRootName: true, embeddedGeometry: true }),
    );
    const rig = await loadSemanticAvatarRig(
      createFile(bytes, "duplicate-root.glb"),
      { familyOverride: "quadruped" },
    );

    expect(rig.nodesByRole.get("root")?.children.length).toBeGreaterThan(0);
    rig.root.clear();
  });
});

function createQuadrupedDocument({
  actionNames,
  animated = false,
  duplicateRootName = false,
  embeddedGeometry = false,
  omit,
  restTwist = 0,
  scale = 1,
}: {
  actionNames?: string[];
  animated?: boolean;
  duplicateRootName?: boolean;
  embeddedGeometry?: boolean;
  omit?: string;
  restTwist?: number;
  scale?: number;
} = {}) {
  const document = new Document();
  const scene = document.createScene("quadruped");
  document.getRoot().setDefaultScene(scene);
  const nodes = new Map<string, Node>();
  for (const role of QUADRUPED_RIG_DEFINITION.roles) {
    if (role.id === omit) continue;
    const node = document
      .createNode(role.id)
      .setTranslation(scaleTuple(restTranslation(role.id), scale))
      .setRotation(
        role.id.endsWith(".upper")
          ? [0, Math.sin(restTwist / 2), 0, Math.cos(restTwist / 2)]
          : [0, 0, 0, 1],
      );
    nodes.set(role.id, node);
  }
  for (const role of QUADRUPED_RIG_DEFINITION.roles) {
    const node = nodes.get(role.id);
    if (!node) continue;
    const parent = role.parent ? nodes.get(role.parent) : undefined;
    if (parent) parent.addChild(node);
    else scene.addChild(node);
  }
  for (const name of actionNames ?? (animated ? ["walk"] : [])) {
    addAnimation(document, nodes, scale, name);
  }
  if (duplicateRootName) {
    scene.addChild(document.createNode("root"));
  }
  if (embeddedGeometry) {
    const buffer = document.createBuffer("geometry");
    const position = document
      .createAccessor("position")
      .setArray(new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]))
      .setType(Accessor.Type.VEC3)
      .setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute("POSITION", position);
    const mesh = document.createMesh("marker").addPrimitive(primitive);
    scene.addChild(document.createNode("marker").setMesh(mesh));
  }
  return document;
}

function createHumanoidRigDocument() {
  const document = new Document();
  const scene = document.createScene("humanoid");
  document.getRoot().setDefaultScene(scene);
  const nodes = new Map<string, Node>();
  for (const role of HUMANOID_RIG_DEFINITION.roles) {
    nodes.set(
      role.id,
      document
        .createNode(role.id)
        .setTranslation(role.id === "hips" ? [0, 1, 0] : [0, 0.1, 0]),
    );
  }
  for (const role of HUMANOID_RIG_DEFINITION.roles) {
    const node = nodes.get(role.id)!;
    const parent = role.parent ? nodes.get(role.parent) : undefined;
    if (parent) parent.addChild(node);
    else scene.addChild(node);
  }
  return document;
}

function addAnimation(
  document: Document,
  nodes: ReadonlyMap<string, Node>,
  scale: number,
  name = "walk",
) {
  const buffer = document.createBuffer("motion");
  const animation = document.createAnimation(name);
  for (const role of QUADRUPED_RIG_DEFINITION.roles) {
    const node = nodes.get(role.id);
    if (!node) continue;
    const input = document
      .createAccessor(`${role.id}.time`)
      .setArray(new Float32Array([0, 1]))
      .setType(Accessor.Type.SCALAR)
      .setBuffer(buffer);
    const angle = role.id.includes("Left") ? 0.25 : -0.2;
    const output = document
      .createAccessor(`${role.id}.rotation`)
      .setArray(
        new Float32Array([
          ...node.getRotation(),
          Math.sin(angle / 2),
          0,
          0,
          Math.cos(angle / 2),
        ]),
      )
      .setType(Accessor.Type.VEC4)
      .setBuffer(buffer);
    const sampler = document
      .createAnimationSampler(`${role.id}.rotation.sampler`)
      .setInput(input)
      .setOutput(output)
      .setInterpolation("LINEAR");
    const channel = document
      .createAnimationChannel(`${role.id}.rotation.channel`)
      .setTargetNode(node)
      .setTargetPath("rotation")
      .setSampler(sampler);
    animation.addSampler(sampler).addChannel(channel);
  }
  const root = nodes.get("root")!;
  const input = document
    .createAccessor("root.translation.time")
    .setArray(new Float32Array([0, 1]))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const output = document
    .createAccessor("root.translation")
    .setArray(new Float32Array([0, 0, 0, 0, 0, scale]))
    .setType(Accessor.Type.VEC3)
    .setBuffer(buffer);
  const sampler = document
    .createAnimationSampler("root.translation.sampler")
    .setInput(input)
    .setOutput(output)
    .setInterpolation("LINEAR");
  const channel = document
    .createAnimationChannel("root.translation.channel")
    .setTargetNode(root)
    .setTargetPath("translation")
    .setSampler(sampler);
  animation.addSampler(sampler).addChannel(channel);
}

function convertRootTranslationToCubic(document: Document) {
  const channel = document
    .getRoot()
    .listAnimations()[0]!
    .listChannels()
    .find(
      (candidate) =>
        candidate.getTargetNode()?.getName() === "root" &&
        candidate.getTargetPath() === "translation",
    )!;
  channel
    .getSampler()!
    .setInterpolation("CUBICSPLINE")
    .getOutput()!
    .setArray(
      new Float32Array([
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0,
      ]),
    );
}

function restTranslation(role: string): [number, number, number] {
  if (role === "root") return [0, 0, 0];
  if (role === "pelvis") return [0, 0.8, 0];
  if (role === "spine" || role === "chest") return [0, 0, -0.35];
  if (role === "neck" || role === "head") return [0, 0.05, -0.25];
  if (role.includes("frontLeft") || role.includes("hindLeft")) {
    return role.endsWith(".upper") ? [-0.22, -0.15, 0] : [0, -0.35, 0];
  }
  if (role.includes("frontRight") || role.includes("hindRight")) {
    return role.endsWith(".upper") ? [0.22, -0.15, 0] : [0, -0.35, 0];
  }
  if (role.startsWith("tail")) return [0, 0.02, 0.25];
  return [0, 0.05, 0];
}

function scaleTuple(
  value: [number, number, number],
  scale: number,
): [number, number, number] {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

async function writeDocument(document: Document) {
  return new WebIO().writeBinary(document);
}

function createFile(bytes: Uint8Array, name: string) {
  return new File(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    name,
    { type: "model/gltf-binary" },
  );
}
