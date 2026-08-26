import { WebIO, type Document, type Node } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { BINDING_DIAGNOSTIC_POSES } from "@/validation/binding-deformation";
import manifest from "./manifest.json";

// Declared geometric acceptance criteria, relative to character height. These
// are for the pinned mannequin and pose set, not a universal human-quality score.
export const BINDING_QUALITY_LIMITS = manifest.qualityLimits;

export async function measureBindingQuality(referenceBytes: Uint8Array, actualBytes: Uint8Array) {
  const reference = await new WebIO().readBinary(referenceBytes);
  const actual = await new WebIO().readBinary(actualBytes);
  const referenceRest = posedVertices(reference, {});
  const ys = referenceRest.map((point) => point.y);
  const height = Math.max(...ys) - Math.min(...ys);
  const poses = BINDING_DIAGNOSTIC_POSES.slice(1).map((pose, index) => {
    const expected = posedVertices(reference, pose);
    const observed = posedVertices(actual, pose);
    if (expected.length !== observed.length) throw new Error("Quality reference topology does not match output.");
    const errors = expected.map((point, vertex) => point.distanceTo(observed[vertex]) / height).sort((a, b) => a - b);
    const metrics = { pose: ["shoulders", "elbows", "hips", "knees"][index], vertices: errors.length,
      rmsHeight: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length),
      p95Height: errors[Math.floor((errors.length - 1) * .95)], maxHeight: errors[errors.length - 1] };
    return { ...metrics, ok: metrics.rmsHeight <= BINDING_QUALITY_LIMITS.rmsHeight &&
      metrics.p95Height <= BINDING_QUALITY_LIMITS.p95Height && metrics.maxHeight <= BINDING_QUALITY_LIMITS.maxHeight };
  });
  return { ok: poses.every((pose) => pose.ok), reference: "pinned-artist-skin", limits: BINDING_QUALITY_LIMITS, poses };
}

function posedVertices(document: Document, pose: (typeof BINDING_DIAGNOSTIC_POSES)[number]) {
  const bones = collectHumanoidNodes(document);
  const original = new Map<Node, number[]>();
  for (const [bone, node] of bones) {
    const delta = pose[bone];
    if (!delta) continue;
    original.set(node, [...node.getRotation()]);
    const rest = new Quaternion(...node.getWorldRotation()).normalize();
    // Use the same scene-world rotation on different bind orientations, not the
    // same numeric local rotation on potentially different bone coordinate axes.
    const localDelta = rest.clone().invert().multiply(new Quaternion(...delta)).multiply(rest);
    node.setRotation(new Quaternion(...node.getRotation()).normalize().multiply(localDelta).toArray());
  }
  const vertices: Vector3[] = [];
  for (const node of document.getRoot().listNodes()) {
    const skin = node.getSkin();
    if (!skin || !node.getMesh()) continue;
    const matrices = skin.listJoints().map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix())
      .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, []))));
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")!, weights = primitive.getAttribute("WEIGHTS_0")!, indices = primitive.getAttribute("JOINTS_0")!;
      for (let v = 0; v < positions.getCount(); v++) {
        const local = new Vector3().fromArray(positions.getElement(v, []));
        const result = new Vector3();
        const js = indices.getElement(v, []), ws = weights.getElement(v, []);
        for (let i = 0; i < 4; i++) result.addScaledVector(local.clone().applyMatrix4(matrices[js[i]]), ws[i]);
        vertices.push(result);
      }
    }
  }
  for (const [node, rotation] of original) node.setRotation(rotation as [number, number, number, number]);
  return vertices;
}
