import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { WebIO, type GLTF, type Document } from "@gltf-transform/core";
import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { bindingParent } from "@/binding/contracts";
import type { BindingJoint } from "@/binding/types";
import { readBindingContainer } from "@/import/binding-glb";
import manifest from "./manifest.json";

export const BINDING_SOURCE_PATH = manifest.source.path;
export const BINDING_SOURCE_SHA256 = manifest.source.sha256;

/** CC0 Quaternius mannequin. The source rig provides held-out artist landmarks;
 * original skin weights are removed and never passed to the solver. */
export async function bindingFixture(options: { keepSkeleton?: boolean; instances?: boolean; aPose?: boolean } = {}) {
  let source = new Uint8Array(await readFile(BINDING_SOURCE_PATH));
  if (createHash("sha256").update(source).digest("hex") !== BINDING_SOURCE_SHA256) throw new Error("Binding source fixture hash changed.");
  const document = await new WebIO().readBinary(source);
  if (options.aPose) {
    relaxArms(document);
    source = new Uint8Array(await new WebIO().writeBinary(document));
  }
  const bones = collectHumanoidNodes(document);
  const available = new Set(bones.keys());
  const joints: BindingJoint[] = [...bones].map(([bone, node]) => ({
    bone, parent: bindingParent(bone, available), position: [...node.getWorldTranslation()], rotation: [...node.getWorldRotation()],
  }));
  for (const skin of document.getRoot().listSkins()) skin.dispose();
  for (const animation of document.getRoot().listAnimations()) animation.dispose();
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    for (const semantic of primitive.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(semantic)) primitive.setAttribute(semantic, null);
  }
  if (!options.keepSkeleton) {
    const scene = document.getRoot().getDefaultScene()!;
    for (const node of document.getRoot().listNodes()) {
      if (!node.getMesh()) continue;
      const matrix = node.getWorldMatrix();
      scene.addChild(node);
      node.setMatrix(matrix);
    }
    for (const node of document.getRoot().listNodes()) if (!node.getMesh()) node.dispose();
  }
  if (options.instances) {
    const sourceNode = document.getRoot().listNodes().find((node) => node.getMesh())!;
    const instance = document.createNode("shared-mesh-instance").setMesh(sourceNode.getMesh())
      .setTranslation([2.3, .4, -.2]).setScale([.7, 1.2, .9]).setRotation([0, Math.sin(.2), 0, Math.cos(.2)]);
    document.getRoot().getDefaultScene()!.addChild(instance);
  }
  const root = document.getRoot();
  for (const accessor of root.listAccessors()) {
    if (accessor.listParents().every((parent) => parent === root)) accessor.dispose();
  }
  const bytes = await new WebIO().writeBinary(document);
  return { bytes: bytes.slice().buffer as ArrayBuffer, joints, source };
}

// Derive a legal A-pose fixture from the pinned artist rig, then discard its
// weights just like the T-pose source. This is fixture preparation, not fitting.
function relaxArms(document: Document) {
  const bones = collectHumanoidNodes(document);
  for (const [bone, angle] of [["leftUpperArm", -.55], ["rightUpperArm", .55]] as const) {
    const node = bones.get(bone)!;
    const world = new Quaternion(...node.getWorldRotation()).normalize();
    const delta = world.clone().invert().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle)).multiply(world);
    node.setRotation(new Quaternion(...node.getRotation()).multiply(delta).normalize().toArray());
  }
  for (const node of document.getRoot().listNodes()) {
    const skin = node.getSkin(); if (!skin || !node.getMesh()) continue;
    const world = new Matrix4().fromArray(node.getWorldMatrix()), inverse = world.clone().invert();
    const transforms = skin.listJoints().map((joint, index) => inverse.clone().multiply(new Matrix4().fromArray(joint.getWorldMatrix()))
      .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, []))));
    const normals = transforms.map((matrix) => new Matrix3().getNormalMatrix(matrix));
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")!, normal = primitive.getAttribute("NORMAL");
      const joints = primitive.getAttribute("JOINTS_0")!, weights = primitive.getAttribute("WEIGHTS_0")!;
      for (let vertex = 0; vertex < positions.getCount(); vertex++) {
        const rest = new Vector3().fromArray(positions.getElement(vertex, [])), restNormal = normal ? new Vector3().fromArray(normal.getElement(vertex, [])) : null;
        const result = new Vector3(), resultNormal = new Vector3(), js = joints.getElement(vertex, []), ws = weights.getElement(vertex, []);
        for (let i = 0; i < 4; i++) {
          result.addScaledVector(rest.clone().applyMatrix4(transforms[js[i]]), ws[i]);
          if (restNormal) resultNormal.addScaledVector(restNormal.clone().applyMatrix3(normals[js[i]]), ws[i]);
        }
        positions.setElement(vertex, result.toArray());
        normal?.setElement(vertex, resultNormal.normalize().toArray());
      }
    }
    skin.listJoints().forEach((joint, index) => skin.getInverseBindMatrices()!.setElement(index,
      new Matrix4().fromArray(joint.getWorldMatrix()).invert().multiply(world).elements));
  }
}

/** Test-only container rewrite; deliberately bypasses schema validation. */
export function rewriteBindingFixture(bytes: ArrayBuffer | Uint8Array, edit: (json: GLTF.IGLTF, binary: Uint8Array) => void) {
  const { json, binary: source } = readBindingContainer(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const binary = source.slice();
  edit(json, binary);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(text.length / 4) * 4;
  const output = new Uint8Array(28 + length + binary.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, output.length, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + length); output.set(text, 20);
  view.setUint32(20 + length, binary.length, true); view.setUint32(24 + length, 0x004e4942, true);
  output.set(binary, 28 + length);
  return output.buffer;
}
