import type { GLTF } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { BindingGLB } from "@/import/binding-glb";
import { bindingLocalTransforms } from "@/binding/rig";
import { bindingError } from "@/binding/contracts";
import type { HumanoidBindingSnapshot } from "@/binding/types";
import { assertOutputBytes, type ProcessingBudget } from "@/processing-budget";

/** Append-only authoring preserves original resources and source node indices. */
export function exportHumanoidBindingGLB(asset: BindingGLB, snapshot: HumanoidBindingSnapshot,
  budget: ProcessingBudget, checkpoint: (phase: string) => void) {
  if (!snapshot.weights) bindingError("BINDING_WEIGHTS_INVALID", "Skin weights are required before export.");
  const json = structuredClone(asset.json);
  const nodes = json.nodes!;
  const jointOffset = nodes.length;
  const locals = bindingLocalTransforms(snapshot.joints);
  const pieces: Uint8Array[] = [asset.binary];
  let byteLength = asset.binary.length;
  json.accessors ??= [];
  json.bufferViews ??= [];
  json.skins ??= [];
  json.meshes ??= [];
  const append = (values: Float32Array | Uint16Array, type: GLTF.IAccessor["type"], components: number) => {
    const padding = (4 - byteLength % 4) % 4;
    if (padding) { pieces.push(new Uint8Array(padding)); byteLength += padding; }
    const view = json.bufferViews!.length;
    json.bufferViews!.push({ buffer: 0, byteOffset: byteLength, byteLength: values.byteLength });
    // Write little endian explicitly; host byte order is not an API assumption.
    const bytes = new Uint8Array(values.byteLength);
    const data = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++) {
      if (values instanceof Float32Array) data.setFloat32(i * 4, values[i], true);
      else data.setUint16(i * 2, values[i], true);
    }
    pieces.push(bytes); byteLength += bytes.length;
    assertOutputBytes(byteLength, budget);
    const accessor = json.accessors!.length;
    json.accessors!.push({ bufferView: view, componentType: values instanceof Float32Array ? 5126 : 5123,
      count: values.length / components, type });
    return accessor;
  };
  for (const [i, joint] of snapshot.joints.entries()) {
    nodes.push({ name: joint.bone, ...locals[i], children: snapshot.joints.flatMap((child, childIndex) =>
      child.parent === joint.bone ? [jointOffset + childIndex] : []),
      extras: { humanoidBindingRole: joint.bone, humanoidBindingRigRevision: snapshot.rigRevision } });
  }
  const root = jointOffset + snapshot.joints.findIndex((joint) => joint.parent === null);
  json.scenes![0].nodes!.push(root);
  const byNode = new Map<number, number>();
  for (const [i, geometry] of asset.geometry.entries()) {
    checkpoint("binding-export-mesh");
    const identity = geometry.identity;
    let meshIndex = byNode.get(identity.node);
    if (meshIndex === undefined) {
      // An instance needs its own weights and bind matrices even when the input
      // mesh/accessors are shared with another transformed node.
      meshIndex = json.meshes.length;
      json.meshes.push(structuredClone(json.meshes[identity.mesh]));
      nodes[identity.node].mesh = meshIndex;
      byNode.set(identity.node, meshIndex);
      const meshWorld = new Matrix4().fromArray(geometry.worldMatrix);
      const inverseBinds = new Float32Array(snapshot.joints.length * 16);
      snapshot.joints.forEach((joint, j) => {
        const inverse = new Matrix4().compose(new Vector3(...joint.position), new Quaternion(...joint.rotation), new Vector3(1, 1, 1))
          .invert().multiply(meshWorld);
        inverseBinds.set(inverse.elements, j * 16);
      });
      nodes[identity.node].skin = json.skins.length;
      json.skins.push({ name: `binding-node-${identity.node}`, skeleton: root,
        joints: snapshot.joints.map((_, j) => jointOffset + j), inverseBindMatrices: append(inverseBinds, "MAT4", 16) });
    }
    const weights = snapshot.weights[i];
    const primitive = json.meshes[meshIndex].primitives[identity.primitive];
    primitive.attributes.JOINTS_0 = append(new Uint16Array(weights.joints), "VEC4", 4);
    primitive.attributes.WEIGHTS_0 = append(new Float32Array(weights.weights), "VEC4", 4);
  }
  json.extras = { ...json.extras, humanoidBinding: { schemaVersion: 1, profile: snapshot.profile,
    sourceSha256: snapshot.asset.sha256, snapshotRevision: snapshot.revision, rigRevision: snapshot.rigRevision,
    jointNodes: snapshot.joints.map((_, i) => i + jointOffset) } };
  json.buffers = [{ ...json.buffers![0], byteLength }];
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = Math.ceil(byteLength / 4) * 4;
  const total = 28 + jsonLength + binaryLength;
  assertOutputBytes(total, budget);
  if (total > 0xffff_ffff) bindingError("PROCESSING_BUDGET_EXCEEDED", "The output exceeds the GLB 32-bit container length.");
  const output = new Uint8Array(total);
  const header = new DataView(output.buffer);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, total, true);
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + jsonLength); output.set(encoded, 20);
  header.setUint32(20 + jsonLength, binaryLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true);
  let offset = 28 + jsonLength;
  for (const piece of pieces) { output.set(piece, offset); offset += piece.length; }
  return output;
}
