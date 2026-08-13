import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Accessor, Document, WebIO, type Node as GltfNode } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  formatAssetValidationReport,
  validateAssetFile,
} from "@/asset-validation";
import { REQUIRED_VRM_BONES, type HumanoidBoneName } from "@/retarget";

const execFileAsync = promisify(execFile);

describe("asset validation", () => {
  it("passes a canonical skinned character GLB", async () => {
    const result = await validateAssetFile(
      createFile(await createCharacterGLB(), "avatar.glb"),
      "character",
    );

    expect(result.ok).toBe(true);
    expect(result.summary.boneCount).toBeGreaterThanOrEqual(REQUIRED_VRM_BONES.length);
  });

  it("passes a canonical character with an embedded base color texture", async () => {
    const result = await validateAssetFile(
      createFile(await createCharacterGLB({ textured: true }), "textured-avatar.glb"),
      "character",
    );

    expect(result.ok).toBe(true);
  });

  it("fails a character GLB missing a required bone by name", async () => {
    const result = await validateAssetFile(
      createFile(await createCharacterGLB({ omit: "leftHand" }), "avatar.glb"),
      "character",
    );
    const report = formatAssetValidationReport(result);

    expect(result.ok).toBe(false);
    expect(report).toContain("Missing leftHand");
  });

  it("fails a character GLB with more than 4 non-zero vertex influences", async () => {
    const result = await validateAssetFile(
      createFile(await createCharacterGLB({ extraInfluence: true }), "avatar.glb"),
      "character",
    );

    expect(result.ok).toBe(false);
    expect(formatAssetValidationReport(result)).toContain("5 non-zero joint weights");
  });

  it("passes a canonical motion GLB", async () => {
    const result = await validateAssetFile(
      createFile(await createMotionGLB(), "walk.glb"),
      "motion",
    );

    expect(result.ok).toBe(true);
    expect(result.summary.motionTrackCount).toBeGreaterThanOrEqual(
      REQUIRED_VRM_BONES.length,
    );
  });

  it("runs the validate-asset CLI end to end", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "validate-asset-"));
    const filePath = path.join(dir, "walk.glb");
    await writeFile(filePath, await createMotionGLB());

    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/validate-asset.mjs", filePath, "--kind", "motion"],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("PASS motion asset");
  });
});

async function createCharacterGLB(options: {
  omit?: HumanoidBoneName;
  extraInfluence?: boolean;
  textured?: boolean;
} = {}) {
  const document = new Document();
  const buffer = document.createBuffer("buffer");
  const scene = document.createScene("scene");
  document.getRoot().setDefaultScene(scene);

  const bones = createRequiredBoneNodes(document, options.omit);
  scene.addChild(bones.get("hips")!);

  const skin = document.createSkin("skin").setSkeleton(bones.get("hips")!);
  for (const bone of REQUIRED_VRM_BONES) {
    const node = bones.get(bone);
    if (node) {
      skin.addJoint(node);
    }
  }
  skin.setInverseBindMatrices(
    document
      .createAccessor("inverseBindMatrices")
      .setType(Accessor.Type.MAT4)
      .setArray(new Float32Array(skin.listJoints().length * 16).map((_, index) =>
        index % 5 === 0 ? 1 : 0,
      ))
      .setBuffer(buffer),
  );

  const material = document.createMaterial("material").setBaseColorFactor([1, 1, 1, 1]);
  if (options.textured) {
    material.setBaseColorTexture(
      document
        .createTexture("base-color")
        .setURI("base-color.png")
        .setMimeType("image/png")
        .setImage(PNG_1X1),
    );
  }

  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document
        .createAccessor("POSITION")
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array([0, 1, 0, 0.1, 1, 0, 0, 1.1, 0]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      document
        .createAccessor("NORMAL")
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      document
        .createAccessor("TEXCOORD_0")
        .setType(Accessor.Type.VEC2)
        .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "JOINTS_0",
      document
        .createAccessor("JOINTS_0")
        .setType(Accessor.Type.VEC4)
        .setArray(new Uint16Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "WEIGHTS_0",
      document
        .createAccessor("WEIGHTS_0")
        .setType(Accessor.Type.VEC4)
        .setArray(
          new Float32Array(
            options.extraInfluence
              ? [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]
              : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
          ),
        )
        .setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor("indices")
        .setType(Accessor.Type.SCALAR)
        .setArray(new Uint16Array([0, 1, 2]))
        .setBuffer(buffer),
    )
    .setMaterial(material);

  if (options.extraInfluence) {
    primitive
      .setAttribute(
        "JOINTS_1",
        document
          .createAccessor("JOINTS_1")
          .setType(Accessor.Type.VEC4)
          .setArray(new Uint16Array([4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0]))
          .setBuffer(buffer),
      )
      .setAttribute(
        "WEIGHTS_1",
        document
          .createAccessor("WEIGHTS_1")
          .setType(Accessor.Type.VEC4)
          .setArray(new Float32Array([0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0]))
          .setBuffer(buffer),
      );
  }

  const mesh = document.createMesh("mesh").addPrimitive(primitive);
  scene.addChild(document.createNode("mesh-node").setMesh(mesh).setSkin(skin));

  return new WebIO().writeBinary(document);
}

async function createMotionGLB() {
  const document = new Document();
  const buffer = document.createBuffer("buffer");
  const scene = document.createScene("scene");
  const animation = document.createAnimation("walk");
  const times = document
    .createAccessor("times")
    .setType(Accessor.Type.SCALAR)
    .setArray(new Float32Array([0, 1 / 30]))
    .setBuffer(buffer);
  document.getRoot().setDefaultScene(scene);

  for (const bone of REQUIRED_VRM_BONES) {
    const node = document.createNode(bone);
    scene.addChild(node);
    addAnimationChannel(document, animation, times, node, "rotation", buffer);
    if (bone === "hips") {
      addAnimationChannel(document, animation, times, node, "translation", buffer);
    }
  }

  return new WebIO().writeBinary(document);
}

function createRequiredBoneNodes(document: Document, omit?: HumanoidBoneName) {
  const nodes = new Map<HumanoidBoneName, GltfNode>();
  for (const bone of REQUIRED_VRM_BONES) {
    if (bone !== omit) {
      nodes.set(bone, document.createNode(bone));
    }
  }

  nodes.get("hips")?.setTranslation([0, 1, 0]);
  nodes.get("spine")?.setTranslation([0, 0.35, 0]);
  nodes.get("head")?.setTranslation([0, 0.55, 0]);
  nodes.get("leftUpperArm")?.setTranslation([-0.25, 0.3, 0]);
  nodes.get("leftLowerArm")?.setTranslation([-0.35, 0, 0]);
  nodes.get("leftHand")?.setTranslation([-0.25, 0, 0]);
  nodes.get("rightUpperArm")?.setTranslation([0.25, 0.3, 0]);
  nodes.get("rightLowerArm")?.setTranslation([0.35, 0, 0]);
  nodes.get("rightHand")?.setTranslation([0.25, 0, 0]);
  nodes.get("leftUpperLeg")?.setTranslation([-0.12, -0.45, 0]);
  nodes.get("leftLowerLeg")?.setTranslation([0, -0.45, 0]);
  nodes.get("leftFoot")?.setTranslation([0, -0.1, -0.2]);
  nodes.get("rightUpperLeg")?.setTranslation([0.12, -0.45, 0]);
  nodes.get("rightLowerLeg")?.setTranslation([0, -0.45, 0]);
  nodes.get("rightFoot")?.setTranslation([0, -0.1, -0.2]);

  addChild(nodes, "hips", "spine");
  addChild(nodes, "spine", "head");
  addChild(nodes, "spine", "leftUpperArm");
  addChild(nodes, "leftUpperArm", "leftLowerArm");
  addChild(nodes, "leftLowerArm", "leftHand");
  addChild(nodes, "spine", "rightUpperArm");
  addChild(nodes, "rightUpperArm", "rightLowerArm");
  addChild(nodes, "rightLowerArm", "rightHand");
  addChild(nodes, "hips", "leftUpperLeg");
  addChild(nodes, "leftUpperLeg", "leftLowerLeg");
  addChild(nodes, "leftLowerLeg", "leftFoot");
  addChild(nodes, "hips", "rightUpperLeg");
  addChild(nodes, "rightUpperLeg", "rightLowerLeg");
  addChild(nodes, "rightLowerLeg", "rightFoot");

  return nodes;
}

function addChild(
  nodes: ReadonlyMap<HumanoidBoneName, GltfNode>,
  parent: HumanoidBoneName,
  child: HumanoidBoneName,
) {
  const parentNode = nodes.get(parent);
  const childNode = nodes.get(child);
  if (parentNode && childNode) {
    parentNode.addChild(childNode);
  }
}

function addAnimationChannel(
  document: Document,
  animation: ReturnType<Document["createAnimation"]>,
  times: Accessor,
  node: GltfNode,
  pathName: "rotation" | "translation",
  buffer: ReturnType<Document["createBuffer"]>,
) {
  const output = document
    .createAccessor(`${node.getName()}.${pathName}`)
    .setType(pathName === "rotation" ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
    .setArray(
      pathName === "rotation"
        ? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])
        : new Float32Array([0, 0, 0, 0, 0.02, 0]),
    )
    .setBuffer(buffer);
  const sampler = document
    .createAnimationSampler(`${node.getName()}.${pathName}.sampler`)
    .setInput(times)
    .setOutput(output);
  animation.addSampler(sampler).addChannel(
    document
      .createAnimationChannel(`${node.getName()}.${pathName}`)
      .setSampler(sampler)
      .setTargetNode(node)
      .setTargetPath(pathName),
  );
}

function createFile(bytes: Uint8Array, name: string) {
  return new File([bytesToArrayBuffer(bytes)], name, { type: "model/gltf-binary" });
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
