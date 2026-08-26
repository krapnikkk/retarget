import { WebIO, type Node } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { BindingGLB } from "@/import/binding-glb";
import { readBindingGLB } from "@/import/binding-glb";
import type { ParseBudget } from "@/import/parse-budget";
import type { BindingJoint, BindingQuaternion, HumanoidBindingSnapshot, HumanoidBindingValidation } from "@/binding/types";
import type { HumanoidBoneName } from "@/retarget/types";

/** Pinned diagnostic poses. These compare skin semantics, not artistic quality. */
export const BINDING_DIAGNOSTIC_POSES: ReadonlyArray<Partial<Record<HumanoidBoneName, BindingQuaternion>>> = [
  {},
  { leftUpperArm: [0, 0, Math.sin(.4), Math.cos(.4)], rightUpperArm: [0, 0, -Math.sin(.4), Math.cos(.4)] },
  { leftLowerArm: [0, Math.sin(.6), 0, Math.cos(.6)], rightLowerArm: [0, -Math.sin(.6), 0, Math.cos(.6)] },
  { leftUpperLeg: [Math.sin(.35), 0, 0, Math.cos(.35)], rightUpperLeg: [-Math.sin(.35), 0, 0, Math.cos(.35)] },
  { leftLowerLeg: [Math.sin(.6), 0, 0, Math.cos(.6)], rightLowerLeg: [Math.sin(.6), 0, 0, Math.cos(.6)] },
];

/** Independent reload and LBS evaluation. Does not call the binding writer,
 * fitting, diffusion or bind-matrix implementation. */
export async function validateBindingDeformation(asset: BindingGLB, snapshot: HumanoidBindingSnapshot,
  bytes: Uint8Array, checkpoint: (phase: string) => void, budget: ParseBudget, maxAccessorValues = Number.MAX_SAFE_INTEGER): Promise<HumanoidBindingValidation> {
  const height = asset.inspection.bounds.max[1] - asset.inspection.bounds.min[1];
  const tolerance = Math.max(1e-6, height * 2e-5);
  const report: HumanoidBindingValidation = { ok: false, assurance: "experimental",
    structural: { ok: false, issues: [] }, semantic: { ok: false, issues: [], verticesCompared: 0,
      posesCompared: 0, maxRestPositionError: 0, maxDeformedPositionError: 0, tolerance }, ecosystem: { status: "not-run" } };
  try {
    if (!snapshot.weights) throw new Error("Expected snapshot has no weights.");
    // Preflight before WebIO: validation of untrusted output must not fetch an
    // external buffer/image or allocate from unchecked accessor declarations.
    const raw = readBindingGLB(bytes, budget, checkpoint, true, maxAccessorValues);
    // The writer is append-only. Verify that all original resources survived,
    // including attributes this solver does not interpret (UVs, tangents, etc.).
    if (raw.binary.length < asset.binary.length || asset.binary.some((value, i) => raw.binary[i] !== value)) throw new Error("Original binary resources changed.");
    for (const key of ["materials", "textures", "images", "samplers"] as const) {
      if (JSON.stringify(raw.json[key]) !== JSON.stringify(asset.json[key])) throw new Error(`Original ${key} changed.`);
    }
    for (const key of ["accessors", "bufferViews"] as const) {
      if (JSON.stringify(raw.json[key]?.slice(0, asset.json[key]?.length ?? 0) ?? []) !== JSON.stringify(asset.json[key] ?? [])) {
        throw new Error(`Original ${key} changed.`);
      }
    }
    for (const geometry of asset.geometry) {
      const { node, mesh, primitive } = geometry.identity;
      const original = asset.json.meshes![mesh].primitives[primitive];
      const actual = raw.json.meshes![raw.json.nodes![node].mesh!].primitives[primitive];
      const { JOINTS_0: _joints, WEIGHTS_0: _weights, ...attributes } = actual.attributes;
      if (JSON.stringify(original) !== JSON.stringify({ ...actual, attributes })) throw new Error("Original primitive attributes, indices or material changed.");
    }
    for (const [i, original] of asset.json.nodes!.entries()) {
      const { mesh: _mesh, skin: _skin, ...originalProperties } = original;
      const { mesh: _newMesh, skin: _newSkin, ...actualProperties } = raw.json.nodes![i];
      if (JSON.stringify(originalProperties) !== JSON.stringify(actualProperties)) throw new Error("Original node transforms or metadata changed.");
    }
    const document = await new WebIO().readBinary(bytes);
    const nodes = document.getRoot().listNodes();
    const originalTRS = new Map<Node, { position: number[]; rotation: number[]; scale: number[] }>();
    for (const node of nodes) originalTRS.set(node, { position: [...node.getTranslation()], rotation: [...node.getRotation()], scale: [...node.getScale()] });
    const jointNodes: Node[] = [];
    for (const [index, geometry] of asset.geometry.entries()) {
      const node = nodes[geometry.identity.node];
      const primitive = node?.getMesh()?.listPrimitives()[geometry.identity.primitive];
      const skin = node?.getSkin();
      if (!primitive || !skin || skin.listJoints().length !== snapshot.joints.length || !skin.getInverseBindMatrices()) throw new Error("Missing skin, primitive, joints or inverse binds.");
      const position = primitive.getAttribute("POSITION"), joints = primitive.getAttribute("JOINTS_0"), weights = primitive.getAttribute("WEIGHTS_0");
      if (!position || !joints || !weights || joints.getCount() !== geometry.identity.vertexCount ||
        weights.getCount() !== geometry.identity.vertexCount || joints.getType() !== "VEC4" || weights.getType() !== "VEC4") throw new Error("Invalid exported weight dimensions.");
      if (skin.getInverseBindMatrices()!.getCount() !== snapshot.joints.length) throw new Error("Inverse bind count mismatch.");
      const rigNodes = skin.listJoints();
      for (const [j, joint] of snapshot.joints.entries()) {
        if (rigNodes[j].getName() !== joint.bone) throw new Error("Joint order or roles changed.");
        const parent = joint.parent === null ? null : rigNodes[snapshot.joints.findIndex((entry) => entry.bone === joint.parent)];
        if (rigNodes[j].getParentNode() !== parent || rigNodes[j].getExtras().humanoidBindingRigRevision !== snapshot.rigRevision) throw new Error("Joint hierarchy or editing identity changed.");
        if (new Vector3(...rigNodes[j].getWorldTranslation()).distanceTo(new Vector3(...joint.position)) > tolerance ||
          new Quaternion(...rigNodes[j].getWorldRotation()).normalize().angleTo(new Quaternion(...joint.rotation).normalize()) > 1e-5 ||
          rigNodes[j].getWorldScale().some((s) => Math.abs(s - 1) > 1e-5)) throw new Error("Joint bind transforms differ from the snapshot.");
        if (jointNodes[j] && jointNodes[j] !== rigNodes[j]) throw new Error("Mesh instances use different skeletons.");
        jointNodes[j] = rigNodes[j];
      }
      for (let v = 0; v < position.getCount(); v++) {
        const ji = joints.getElement(v, []), w = weights.getElement(v, []);
        if (ji.some((j) => !Number.isInteger(j) || j < 0 || j >= rigNodes.length) ||
          w.some((x) => !Number.isFinite(x) || x < 0) || Math.abs(w.reduce((a, b) => a + b, 0) - 1) > 1e-6) throw new Error("Invalid exported joint indices or weights.");
        const expected = snapshot.weights[index];
        if (ji.some((j, k) => j !== expected.joints[v * 4 + k]) ||
          w.some((weight, k) => Math.abs(weight - expected.weights[v * 4 + k]) > 1e-6)) throw new Error("Exported weights differ from the edited snapshot.");
      }
    }
    report.structural.ok = true;
    for (const [poseIndex, pose] of BINDING_DIAGNOSTIC_POSES.entries()) {
      checkpoint("binding-semantic-pose");
      for (const node of nodes) node.setRotation(originalTRS.get(node)!.rotation as [number, number, number, number]);
      for (const [index, joint] of snapshot.joints.entries()) {
        const delta = pose[joint.bone];
        if (delta) jointNodes[index].setRotation(new Quaternion(...jointNodes[index].getRotation()).multiply(new Quaternion(...delta)).toArray());
      }
      const expectedPose = expectedJointPose(snapshot.joints, pose);
      for (const [meshIndex, geometry] of asset.geometry.entries()) {
        const node = nodes[geometry.identity.node];
        const primitive = node.getMesh()!.listPrimitives()[geometry.identity.primitive];
        const skin = node.getSkin()!;
        const matrices = skin.listJoints().map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix())
          .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, []))));
        const position = primitive.getAttribute("POSITION")!, indices = primitive.getAttribute("JOINTS_0")!, weights = primitive.getAttribute("WEIGHTS_0")!;
        for (let vertex = 0; vertex < geometry.identity.vertexCount; vertex++) {
          if (vertex % 2048 === 0) checkpoint("binding-semantic-vertices");
          const local = new Vector3().fromArray(position.getElement(vertex, []));
          const actual = new Vector3();
          const ji = indices.getElement(vertex, []), w = weights.getElement(vertex, []);
          for (let influence = 0; influence < 4; influence++) actual.addScaledVector(local.clone().applyMatrix4(matrices[ji[influence]]), w[influence]);
          const original = new Vector3().fromArray(geometry.positions, vertex * 3);
          const expected = new Vector3();
          for (let influence = 0; influence < 4; influence++) {
            const offset = vertex * 4 + influence;
            const j = snapshot.weights[meshIndex].joints[offset];
            const weight = snapshot.weights[meshIndex].weights[offset];
            const rest = snapshot.joints[j];
            const moved = original.clone().sub(new Vector3(...rest.position))
              .applyQuaternion(new Quaternion(...rest.rotation).invert()).applyQuaternion(expectedPose[j].rotation)
              .add(expectedPose[j].position);
            expected.addScaledVector(moved, weight);
          }
          const error = actual.distanceTo(expected);
          if (!Number.isFinite(error)) throw new Error("Non-finite deformed vertex.");
          report.semantic.maxDeformedPositionError = Math.max(report.semantic.maxDeformedPositionError, error);
          if (poseIndex === 0) report.semantic.maxRestPositionError = Math.max(report.semantic.maxRestPositionError, actual.distanceTo(original));
          report.semantic.verticesCompared++;
        }
      }
      report.semantic.posesCompared++;
    }
    if (report.semantic.maxRestPositionError > tolerance) report.semantic.issues.push("Bind-pose surface changed.");
    if (report.semantic.maxDeformedPositionError > tolerance) report.semantic.issues.push("Exported skin deformation differs from the snapshot.");
    report.semantic.ok = report.semantic.issues.length === 0;
    report.ok = report.structural.ok && report.semantic.ok;
  } catch (error) {
    // Budget/deadline failures must escape as their registered public errors.
    if (error && typeof error === "object" && "code" in error &&
      (String(error.code).startsWith("PROCESSING_") || error.code === "PARSE_BUDGET_EXCEEDED")) throw error;
    const issues = report.structural.ok ? report.semantic.issues : report.structural.issues;
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return report;
}

function expectedJointPose(joints: BindingJoint[], pose: Partial<Record<HumanoidBoneName, BindingQuaternion>>) {
  const result: Array<{ position: Vector3; rotation: Quaternion }> = [];
  const solve = (index: number): { position: Vector3; rotation: Quaternion } => {
    if (result[index]) return result[index];
    const joint = joints[index];
    const parentIndex = joints.findIndex((candidate) => candidate.bone === joint.parent);
    const position = new Vector3(...joint.position);
    const rotation = new Quaternion(...joint.rotation);
    if (parentIndex >= 0) {
      const parent = joints[parentIndex];
      const posedParent = solve(parentIndex);
      const restInverse = new Quaternion(...parent.rotation).invert();
      position.sub(new Vector3(...parent.position)).applyQuaternion(restInverse).applyQuaternion(posedParent.rotation).add(posedParent.position);
      rotation.premultiply(restInverse).premultiply(posedParent.rotation);
    }
    if (pose[joint.bone]) rotation.multiply(new Quaternion(...pose[joint.bone]!));
    return result[index] = { position, rotation };
  };
  joints.forEach((_, index) => solve(index));
  return result;
}
