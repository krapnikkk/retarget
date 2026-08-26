import { beforeAll, describe, expect, it, vi } from "vitest";
import { WebIO } from "@gltf-transform/core";
import { readFile } from "node:fs/promises";
import { runRetargetJobInline } from "@/jobs/browser-retarget-job";
import { bindMotionClipToAvatar } from "@/browser/avatar-target-pipeline";
import { exportAnimatedGLB } from "@/export/avatar-glb";
import { exportAnimatedGLBStream } from "@/export/streamed-avatar-glb";
import { processHumanoidBinding } from "@/io";
import { readBindingGLB, readBindingContainer } from "@/import/binding-glb";
import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import { assertHumanoidBindingTask, sealBindingSnapshot } from "@/binding/contracts";
import { inspectHumanoidAvatarBytes } from "@/jobs/inspect-humanoid-avatar";
import { assertRetargetJobResponse } from "@/jobs/runtime-protocol";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";
import type { HumanoidBindingExport, HumanoidBindingSnapshot } from "@/binding/types";
import { bindingFixture, rewriteBindingFixture } from "./fixtures";
import { measureBindingQuality } from "./quality";

vi.mock("@/jobs/browser-retarget-job", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/jobs/browser-retarget-job")>();
  return { ...actual, runRetargetJob: actual.runRetargetJobInline };
});

describe("humanoid binding with the pinned CC0 mannequin", () => {
  let fixture: Awaited<ReturnType<typeof bindingFixture>>;
  let rig: HumanoidBindingSnapshot;
  let skinned: HumanoidBindingSnapshot;
  let exported: HumanoidBindingExport;
  beforeAll(async () => {
    fixture = await bindingFixture();
    rig = await processHumanoidBinding(fixture.bytes, { operation: "use-rig", joints: fixture.joints });
    skinned = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: rig, expectedRevision: rig.revision });
    exported = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: skinned, expectedRevision: skinned.revision });
  }, 30_000);

  it("creates real skin data and independently checks rest/shoulder/elbow/hip/knee deformation", async () => {
    expect(exported.validation).toMatchObject({ ok: true, assurance: "experimental", structural: { ok: true },
      semantic: { ok: true, posesCompared: 5 }, ecosystem: { status: "not-run" } });
    const vertices = rig.asset.primitives.reduce((n, primitive) => n + primitive.vertexCount, 0);
    expect(exported.validation.semantic.verticesCompared).toBe(vertices * 5);
    expect(exported.validation.semantic.maxDeformedPositionError).toBeLessThan(exported.validation.semantic.tolerance);
    const document = await new WebIO().readBinary(exported.bytes);
    expect(document.getRoot().listSkins().length).toBeGreaterThan(0);
    expect(document.getRoot().listSkins()[0].listJoints()).toHaveLength(rig.joints.length);
    const inspection = await inspectHumanoidAvatarBytes({ bytes: exported.bytes.slice().buffer as ArrayBuffer, filename: "bound.glb", formatId: "gltf-humanoid" });
    expect(inspection.missingRequiredBones).toEqual([]);
    expect(() => assertRetargetJobResponse({ schemaVersion: RETARGET_JOB_PROTOCOL_VERSION, jobId: "binding-inspection", type: "success", result: inspection },
      { schemaVersion: RETARGET_JOB_PROTOCOL_VERSION, jobId: "binding-inspection", task: { type: "inspect-humanoid-avatar", bytes: exported.bytes.slice().buffer as ArrayBuffer, filename: "bound.glb", formatId: "gltf-humanoid" } })).not.toThrow();
  });

  it("meets the declared shoulder/elbow/hip/knee quality limits against the artist skin", async () => {
    const quality = await measureBindingQuality(fixture.source, exported.bytes);
    expect(quality.ok, JSON.stringify(quality, null, 2)).toBe(true);
  });

  it("fails quality when structurally legal weights attach the entire character to the hips", async () => {
    const document = await new WebIO().readBinary(exported.bytes);
    const hips = skinned.joints.findIndex((joint) => joint.bone === "hips");
    for (const node of document.getRoot().listNodes()) {
      if (!node.getSkin()) continue;
      for (const primitive of node.getMesh()!.listPrimitives()) {
        const joints = primitive.getAttribute("JOINTS_0")!, weights = primitive.getAttribute("WEIGHTS_0")!;
        for (let vertex = 0; vertex < weights.getCount(); vertex++) {
          joints.setElement(vertex, [hips, 0, 0, 0]); weights.setElement(vertex, [1, 0, 0, 0]);
        }
      }
    }
    const quality = await measureBindingQuality(fixture.source, await new WebIO().writeBinary(document));
    expect(quality.ok).toBe(false);
    expect(quality.poses.filter((pose) => !pose.ok).length).toBeGreaterThanOrEqual(2);
  });

  it("fits a bare mesh from explicit landmarks without importing old weights", async () => {
    const fitted = await processHumanoidBinding(fixture.bytes, { operation: "fit", pose: "t-pose", forward: "+z",
      landmarks: Object.fromEntries(fixture.joints.map((joint) => [joint.bone, joint.position])) });
    expect(fitted.weights).toBeNull();
    expect(fitted.algorithm).toBe("landmark-template-v1");
    const result = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: fitted, expectedRevision: fitted.revision });
    const output = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: result, expectedRevision: result.revision });
    expect(output.validation.ok).toBe(true);
    const quality = await measureBindingQuality(fixture.source, output.bytes);
    expect(quality.ok, JSON.stringify(quality)).toBe(true);
  });

  it("offers an editable template draft for a supported T-pose without supplied landmarks", async () => {
    const fitted = await processHumanoidBinding(fixture.bytes, { operation: "fit", pose: "t-pose", forward: "+z" });
    expect(fitted.algorithm).toBe("landmark-template-v1");
    expect(fitted.diagnostics).toContainEqual(expect.objectContaining({ code: "MANUAL_REVIEW_REQUIRED" }));
  });

  it("uses the generated skin joints when the input retains an unweighted skeleton", async () => {
    const existing = await bindingFixture({ keepSkeleton: true });
    const explicit = await processHumanoidBinding(existing.bytes, { operation: "use-rig", joints: existing.joints });
    const skin = await processHumanoidBinding(existing.bytes, { operation: "skin", snapshot: explicit, expectedRevision: explicit.revision, iterations: 4 });
    const result = await processHumanoidBinding(existing.bytes, { operation: "export", snapshot: skin, expectedRevision: skin.revision });
    const inspection = await inspectHumanoidAvatarBytes({ bytes: result.bytes.slice().buffer as ArrayBuffer, filename: "existing.glb", formatId: "gltf-humanoid" });
    expect(inspection.rigSignature).toContain(skin.rigRevision);
    const raw = readBindingContainer(result.bytes).json;
    const structural = await inspectHumanoidAvatarBytes({ bytes: new ArrayBuffer(0),
      structuralJSONBytes: new TextEncoder().encode(JSON.stringify(raw)).buffer,
      filename: "existing.glb", formatId: "gltf-humanoid" });
    expect(structural.rigSignature).toBe(inspection.rigSignature);
  });

  it("retargets real canonical motion to the generated rig and rejects an edited target", async () => {
    const motionBytes = await readFile("tests/fixtures/certification/golden-motion/motions/quaternius-walk/quaternius-walk.animation.glb");
    const motion = await runRetargetJobInline({ type: "import-motion", formatId: "gltf-animation", filename: "walk.glb", bytes: Uint8Array.from(motionBytes).buffer });
    const target = await inspectHumanoidAvatarBytes({ bytes: exported.bytes.slice().buffer as ArrayBuffer, filename: "bound.glb", formatId: "gltf-humanoid" });
    const avatarFile = new File([exported.bytes.slice()], "bound.glb");
    const clip = await bindMotionClipToAvatar({ avatarFile, avatarFormatId: "gltf-humanoid", clip: motion });
    expect(clip.target.rigSignature).toBe(target.rigSignature);
    const animated = await exportAnimatedGLB({ avatarFile, avatarFormatId: "gltf-humanoid", clip });
    const doc = await new WebIO().readBinary(animated);
    expect(doc.getRoot().listAnimations()[0].listChannels().length).toBeGreaterThan(20);
    await expect(exportAnimatedGLBStream({ avatarFile, clip })).resolves.toBeDefined();
    const head = skinned.joints.find((joint) => joint.bone === "head")!;
    const edited = await processHumanoidBinding(fixture.bytes, { operation: "edit-rig", snapshot: skinned, expectedRevision: skinned.revision,
      edits: [{ bone: "head", position: [head.position[0] + 1e-7, head.position[1], head.position[2]] }] });
    const newSkin = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: edited, expectedRevision: edited.revision, iterations: 4 });
    const changed = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: newSkin, expectedRevision: newSkin.revision });
    const changedFile = new File([changed.bytes.slice()], "changed.glb");
    await expect(exportAnimatedGLB({ avatarFile: changedFile, avatarFormatId: "gltf-humanoid", clip })).rejects.toMatchObject({ code: "TARGET_RIG_MISMATCH" });
    await expect(exportAnimatedGLBStream({ avatarFile: changedFile, clip })).rejects.toMatchObject({ code: "TARGET_RIG_MISMATCH" });
    const weightsOnly = await processHumanoidBinding(fixture.bytes, { operation: "edit-weights", snapshot: skinned, expectedRevision: skinned.revision,
      edits: [{ primitive: skinned.asset.primitives[0].id, vertex: 0, influences: [{ bone: "hips", weight: 1 }] }] });
    const sameRig = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: weightsOnly, expectedRevision: weightsOnly.revision });
    const sameInspection = await inspectHumanoidAvatarBytes({ bytes: sameRig.bytes.slice().buffer as ArrayBuffer, filename: "weight-edit.glb", formatId: "gltf-humanoid" });
    expect(sameInspection.rigSignature).toBe(target.rigSignature);
  });

  it("asks for landmarks when relaxed-pose fitting lacks arm evidence", async () => {
    await expect(processHumanoidBinding(fixture.bytes, { operation: "fit", pose: "a-pose", forward: "+z" }))
      .rejects.toMatchObject({ code: "BINDING_LANDMARKS_REQUIRED" });
  });

  it("fits and skins a derived A-pose with explicit joint landmarks", async () => {
    const fixture = await bindingFixture({ aPose: true });
    const fitted = await processHumanoidBinding(fixture.bytes, { operation: "fit", pose: "a-pose", forward: "+z",
      landmarks: Object.fromEntries(fixture.joints.map((joint) => [joint.bone, joint.position])) });
    const skin = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: fitted, expectedRevision: fitted.revision });
    const output = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: skin, expectedRevision: skin.revision });
    expect(output.validation.ok).toBe(true);
    const quality = await measureBindingQuality(fixture.source, output.bytes);
    expect(quality.ok, JSON.stringify(quality)).toBe(true);
  });

  it("changes the rig revision on joint edits and clears weights without losing locks", async () => {
    const primitive = skinned.asset.primitives[0].id;
    const locked = await processHumanoidBinding(fixture.bytes, { operation: "edit-weights", snapshot: skinned, expectedRevision: skinned.revision,
      edits: [{ primitive, vertex: 0, influences: [{ bone: "hips", weight: 1 }], locks: [{ bone: "hips", weight: 1 }] }] });
    const head = locked.joints.find((joint) => joint.bone === "head")!;
    const changed = await processHumanoidBinding(fixture.bytes, { operation: "edit-rig", snapshot: locked, expectedRevision: locked.revision,
      edits: [{ bone: "head", position: [head.position[0], head.position[1] + .05, head.position[2]] }] });
    expect(changed.rigRevision).not.toBe(locked.rigRevision);
    expect(changed.weights).toBeNull();
    expect(changed.locks).toEqual(locked.locks);
    const regenerated = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: changed, expectedRevision: changed.revision });
    expect(regenerated.weights![0].weights.slice(0, 4)).toEqual([1, 0, 0, 0]);
    expect(regenerated.joints[regenerated.weights![0].joints[0]].bone).toBe("hips");
  });

  it("normalizes, prunes, locks and restores edited weights deterministically", async () => {
    const primitive = skinned.asset.primitives[0].id;
    const changed = await processHumanoidBinding(fixture.bytes, { operation: "edit-weights", snapshot: skinned, expectedRevision: skinned.revision,
      edits: [{ primitive, vertex: 0, influences: [
        { bone: "hips", weight: 2 }, { bone: "spine", weight: 3 }, { bone: "head", weight: 4 },
        { bone: "leftHand", weight: 5 }, { bone: "rightHand", weight: 6 },
      ], locks: [{ bone: "hips", weight: .25 }] }] });
    expect(changed.rigRevision).toBe(skinned.rigRevision);
    expect(changed.revision).not.toBe(skinned.revision);
    expect(changed.weights![0].weights.slice(0, 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const restored = JSON.parse(JSON.stringify(changed)) as HumanoidBindingSnapshot;
    const reskinned = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: restored, expectedRevision: restored.revision });
    const index = reskinned.weights![0].joints.slice(0, 4).findIndex((j) => reskinned.joints[j].bone === "hips");
    expect(reskinned.weights![0].weights[index]).toBe(.25);
    const repeated = await processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: restored, expectedRevision: restored.revision });
    expect(repeated).toEqual(reskinned);
    const repeatedExport = await processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: skinned, expectedRevision: skinned.revision });
    expect(repeatedExport.bytes).toEqual(exported.bytes);
  });

  it.each([
    [{ bone: "hips", weight: .8 }, { bone: "spine", weight: .8 }],
    [{ bone: "hips", weight: .2 }, { bone: "spine", weight: .2 }, { bone: "head", weight: .2 }, { bone: "leftHand", weight: .2 }, { bone: "rightHand", weight: .2 }],
  ])("rejects unsatisfiable lock constraints %j", async (...locks) => {
    await expect(processHumanoidBinding(fixture.bytes, { operation: "edit-weights", snapshot: skinned, expectedRevision: skinned.revision,
      edits: [{ primitive: skinned.asset.primitives[0].id, vertex: 0, locks: locks as never }] }))
      .rejects.toMatchObject({ code: "BINDING_CONSTRAINT_CONFLICT" });
  });

  it("rejects zero mass, illegal bone references and stale revisions", async () => {
    for (const influences of [[], [{ bone: "hips", weight: 0 }], [{ bone: "not-a-bone", weight: 1 }]]) {
      await expect(processHumanoidBinding(fixture.bytes, { operation: "edit-weights", snapshot: skinned, expectedRevision: skinned.revision,
        edits: [{ primitive: skinned.asset.primitives[0].id, vertex: 0, influences: influences as never }] }))
        .rejects.toMatchObject({ code: "BINDING_WEIGHTS_INVALID" });
    }
    await expect(processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: skinned, expectedRevision: rig.revision }))
      .rejects.toMatchObject({ code: "BINDING_EDIT_STALE" });
    const tampered = structuredClone(skinned);
    tampered.joints[0].position[0] += .1;
    await expect(processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: tampered, expectedRevision: tampered.revision }))
      .rejects.toMatchObject({ code: "BINDING_EDIT_STALE" });
  });

  it("rejects changed assets even when vertex counts are unchanged", async () => {
    const doc = await new WebIO().readBinary(new Uint8Array(fixture.bytes));
    doc.getRoot().listNodes()[0].setName("different-asset");
    const other = await new WebIO().writeBinary(doc);
    await expect(processHumanoidBinding(other.slice().buffer as ArrayBuffer, { operation: "skin", snapshot: rig, expectedRevision: rig.revision }))
      .rejects.toMatchObject({ code: "BINDING_EDIT_STALE" });
  });

  it("rejects malformed weights even when a caller recomputes the snapshot digest", async () => {
    const invalid = structuredClone(skinned);
    invalid.weights![0].weights[0] = -1;
    sealBindingSnapshot(invalid);
    await expect(processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: invalid, expectedRevision: invalid.revision }))
      .rejects.toMatchObject({ code: "BINDING_WEIGHTS_INVALID" });
  });

  it("rejects restored lock contradictions, and supports zero locks and explicit unlocks", async () => {
    const primitive = skinned.asset.primitives[0].id;
    const locked = await processHumanoidBinding(fixture.bytes, { operation: "edit-weights", snapshot: skinned, expectedRevision: skinned.revision,
      edits: [{ primitive, vertex: 0, influences: [{ bone: "hips", weight: 1 }, { bone: "spine", weight: 1 }], locks: [{ bone: "hips", weight: 0 }] }] });
    expect(locked.joints[locked.weights![0].joints[0]].bone).toBe("spine");
    const invalid = structuredClone(locked);
    invalid.weights![0].joints[0] = invalid.joints.findIndex((joint) => joint.bone === "hips");
    sealBindingSnapshot(invalid);
    await expect(processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: invalid, expectedRevision: invalid.revision }))
      .rejects.toMatchObject({ code: "BINDING_CONSTRAINT_CONFLICT" });
    const unlocked = await processHumanoidBinding(fixture.bytes, { operation: "edit-weights", snapshot: locked, expectedRevision: locked.revision,
      edits: [{ primitive, vertex: 0, influences: [{ bone: "hips", weight: 1 }], locks: [] }] });
    expect(unlocked.locks).toEqual([]);
    expect(unlocked.joints[unlocked.weights![0].joints[0]].bone).toBe("hips");
  });

  it("preserves multiple primitives, attributes and embedded material resources", async () => {
    const io = new WebIO();
    const document = await io.readBinary(new Uint8Array(fixture.bytes));
    const mesh = document.getRoot().listMeshes()[0];
    const image = document.createTexture("test-pixel").setMimeType("image/png").setImage(new Uint8Array(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64")));
    const material = document.createMaterial("embedded-test").setBaseColorTexture(image);
    mesh.addPrimitive(mesh.listPrimitives()[0].clone().setMaterial(material));
    const bytes = (await io.writeBinary(document)).slice().buffer as ArrayBuffer;
    const rig = await processHumanoidBinding(bytes, { operation: "use-rig", joints: fixture.joints });
    const skin = await processHumanoidBinding(bytes, { operation: "skin", snapshot: rig, expectedRevision: rig.revision });
    expect(skin.diagnostics).toContainEqual(expect.objectContaining({ code: "DISCONNECTED_COMPONENTS" }));
    const output = await processHumanoidBinding(bytes, { operation: "export", snapshot: skin, expectedRevision: skin.revision });
    expect(output.validation.ok).toBe(true);
    const source = readBindingContainer(new Uint8Array(bytes)).json;
    const result = readBindingContainer(output.bytes).json;
    expect(result.images).toEqual(source.images);
    expect(result.materials).toEqual(source.materials);
    const corrupted = rewriteBindingFixture(output.bytes, (json) => {
      const node = json.nodes!.find((item) => item.skin !== undefined)!;
      delete json.meshes![node.mesh!].primitives[0].attributes.NORMAL;
    });
    const validation = await processHumanoidBinding(bytes, { operation: "validate", snapshot: skin, expectedRevision: skin.revision, outputBytes: corrupted });
    expect(validation.structural.ok).toBe(false);
    expect(validation.structural.issues.join(" ")).toContain("primitive");
  });

  it.each<[string, Parameters<typeof rewriteBindingFixture>[1]]>([
    ["external buffer", (json) => { json.buffers![0].uri = "https://invalid.example/asset.bin"; }],
    ["optional extension", (json) => { json.extensionsUsed = ["KHR_mesh_quantization"]; }],
    ["oversized accessor", (json) => { json.accessors![0].count = Number.MAX_SAFE_INTEGER; }],
    ["out of range buffer", (json) => { json.bufferViews![0].byteOffset = Number.MAX_SAFE_INTEGER; }],
    ["reflected transform", (json) => { json.nodes![0].scale = [-1, 1, 1]; delete json.nodes![0].matrix; }],
    ["singular transform", (json) => { json.nodes![0].scale = [0, 1, 1]; delete json.nodes![0].matrix; }],
    ["invalid quaternion", (json) => { json.nodes![0].rotation = [0, 0, 0, 0]; delete json.nodes![0].matrix; }],
    ["shear", (json) => { json.nodes![0] = { ...json.nodes![0], translation: undefined, rotation: undefined, scale: undefined,
      matrix: [1, 0, 0, 0, .5, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }; }],
    ["node cycle", (json) => { json.nodes![0].children = [0]; }],
    ["line topology", (json) => { json.meshes![0].primitives[0].mode = 1; }],
    ["morph target", (json) => { const primitive = json.meshes![0].primitives[0]; primitive.targets = [{ POSITION: primitive.attributes.POSITION }]; }],
    ["non-finite normals", (json, binary) => { const index = json.meshes![0].primitives[0].attributes.NORMAL;
      const accessor = json.accessors![index], view = json.bufferViews![accessor.bufferView!];
      new DataView(binary.buffer).setFloat32((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), NaN, true); }],
  ])("rejects unsupported %s before authoring", async (_label, edit) => {
    const bytes = rewriteBindingFixture(fixture.bytes, edit);
    await expect(processHumanoidBinding(bytes, { operation: "inspect" })).rejects.toMatchObject({ code: "BINDING_INPUT_UNSUPPORTED" });
  });

  it("rejects degenerate triangles and unreferenced source vertices", async () => {
    const io = new WebIO();
    const document = await io.readBinary(new Uint8Array(fixture.bytes));
    const primitive = document.getRoot().listMeshes()[0].listPrimitives()[0];
    const indices = primitive.getIndices()!;
    const original = indices.getScalar(1);
    indices.setScalar(1, indices.getScalar(0));
    await expect(processHumanoidBinding((await io.writeBinary(document)).slice().buffer as ArrayBuffer, { operation: "inspect" }))
      .rejects.toMatchObject({ code: "BINDING_INPUT_UNSUPPORTED" });
    indices.setScalar(1, original);
    for (const semantic of primitive.listSemantics()) {
      const accessor = primitive.getAttribute(semantic)!, values = accessor.getArray()!;
      accessor.setArray(new Float32Array([...values, ...values.slice(0, accessor.getElementSize())]));
    }
    await expect(processHumanoidBinding((await io.writeBinary(document)).slice().buffer as ArrayBuffer, { operation: "inspect" }))
      .rejects.toMatchObject({ code: "BINDING_INPUT_UNSUPPORTED" });
  });

  it("rejects invalid rig hierarchy, duplicate roles and zero-length bones", async () => {
    for (const mutate of [
      (joints: typeof fixture.joints) => { joints[0].parent = joints[0].bone; },
      (joints: typeof fixture.joints) => { joints.push(structuredClone(joints[0])); },
      (joints: typeof fixture.joints) => { const child = joints.find((joint) => joint.parent)!; child.position = joints.find((joint) => joint.bone === child.parent)!.position; },
    ]) {
      const joints = structuredClone(fixture.joints); mutate(joints);
      await expect(processHumanoidBinding(fixture.bytes, { operation: "use-rig", joints })).rejects.toMatchObject({ code: "BINDING_RIG_INVALID" });
    }
  });

  it("rejects non-serializable commands before invoking user getters or cloning", () => {
    const getter = vi.fn();
    const withGetter = Object.defineProperty({ operation: "fit" }, "landmarks", { enumerable: true, get: getter });
    const cyclic: Record<string, unknown> = { operation: "fit" }; cyclic.landmarks = cyclic;
    for (const command of [withGetter, cyclic, { operation: "use-rig", joints: new Array(3) },
      { operation: "use-rig", joints: [{ weight: Infinity }] }, { operation: "inspect", unexpected: true }]) {
      expect(() => assertHumanoidBindingTask({ type: "humanoid-binding", bytes: fixture.bytes, command }))
        .toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("distinguishes transformed instances sharing the same mesh", async () => {
    const shared = await bindingFixture({ instances: true });
    const inspection = await processHumanoidBinding(shared.bytes, { operation: "inspect" });
    expect(new Set(inspection.asset.primitives.map((p) => p.id)).size).toBe(inspection.asset.primitives.length);
    const rig = await processHumanoidBinding(shared.bytes, { operation: "use-rig", joints: shared.joints });
    const skin = await processHumanoidBinding(shared.bytes, { operation: "skin", snapshot: rig, expectedRevision: rig.revision, iterations: 8 });
    const result = await processHumanoidBinding(shared.bytes, { operation: "export", snapshot: skin, expectedRevision: skin.revision });
    expect(result.validation.ok).toBe(true);
    const raw = readBindingContainer(result.bytes).json;
    const nodes = raw.nodes!.filter((node) => node.mesh !== undefined);
    expect(new Set(nodes.map((node) => node.skin)).size).toBe(nodes.length);
    expect(new Set(nodes.map((node) => node.mesh)).size).toBe(nodes.length);
  });

  it("detects inverse-bind corruption through vertex deformation", async () => {
    const corrupted = exported.bytes.slice();
    const { json, binary } = readBindingContainer(corrupted);
    const accessor = json.accessors![json.skins![0].inverseBindMatrices!];
    const offset = json.bufferViews![accessor.bufferView!].byteOffset! + (accessor.byteOffset ?? 0);
    const view = new DataView(binary.buffer, binary.byteOffset + offset);
    view.setFloat32(12 * 4, view.getFloat32(12 * 4, true) + 1, true);
    const validation = await processHumanoidBinding(fixture.bytes, { operation: "validate", snapshot: skinned,
      expectedRevision: skinned.revision, outputBytes: corrupted.buffer });
    expect(validation.structural.ok).toBe(true);
    expect(validation.semantic.ok).toBe(false);
    expect(validation.semantic.maxRestPositionError).toBeGreaterThan(.01);
  });

  it("enforces consumer work/vertex/output budgets and inner-loop deadlines", async () => {
    await expect(processHumanoidBinding(fixture.bytes, { operation: "inspect" }, { parseBudget: { maxVertices: 10 } })).rejects.toMatchObject({ code: "PARSE_BUDGET_EXCEEDED" });
    await expect(processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: rig, expectedRevision: rig.revision },
      { processingBudget: { maxGeneratedValues: 10 } })).rejects.toMatchObject({ code: "PROCESSING_BUDGET_EXCEEDED" });
    await expect(processHumanoidBinding(fixture.bytes, { operation: "export", snapshot: skinned, expectedRevision: skinned.revision },
      { processingBudget: { maxOutputBytes: 10 } })).rejects.toMatchObject({ code: "PROCESSING_BUDGET_EXCEEDED" });
    await expect(processHumanoidBinding(fixture.bytes, { operation: "skin", snapshot: rig, expectedRevision: rig.revision },
      { deadlineMs: .00001 })).rejects.toMatchObject({ code: "PROCESSING_DEADLINE_EXCEEDED" });
  });

  it("requires GLB content and rejects already-skinned input", async () => {
    await expect(processHumanoidBinding(new TextEncoder().encode("not a glb despite its filename").buffer, { operation: "inspect" }))
      .rejects.toMatchObject({ code: "BINDING_INPUT_UNSUPPORTED" });
    await expect(processHumanoidBinding(exported.bytes.slice().buffer as ArrayBuffer, { operation: "inspect" }))
      .rejects.toMatchObject({ code: "BINDING_INPUT_UNSUPPORTED" });
    expect(() => readBindingGLB(new Uint8Array(fixture.bytes).subarray(0, 25), DEFAULT_PARSE_BUDGET, () => undefined))
      .toThrow(expect.objectContaining({ code: "BINDING_INPUT_UNSUPPORTED" }));
  });
});
