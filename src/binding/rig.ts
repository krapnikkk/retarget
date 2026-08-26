import { Quaternion, Vector3 } from "three";
import { HUMANOID_BONES, type HumanoidBoneName } from "@/retarget/types";
import type { BindingGLB } from "@/import/binding-glb";
import { bindingError, bindingParent, exactKeys, finiteTuple, sealBindingSnapshot, validateBindingJoints } from "./contracts";
import type { BindingJoint, BindingVector3, HumanoidBindingCommand, HumanoidBindingSnapshot } from "./types";

export function createBindingRig(asset: BindingGLB, joints: BindingJoint[], algorithm: HumanoidBindingSnapshot["algorithm"]) {
  validateBindingJoints(joints);
  const ordered = HUMANOID_BONES.flatMap((bone) => {
    const joint = joints.find((entry) => entry.bone === bone);
    return joint ? [{ ...structuredClone(joint), rotation: new Quaternion(...joint.rotation).normalize().toArray() }] : [];
  });
  return sealBindingSnapshot({ schemaVersion: 1, profile: "humanoid-binding-v1",
    asset: structuredClone(asset.inspection.asset), revision: "", rigRevision: "", joints: ordered,
    weights: null, locks: [], algorithm, skinning: null,
    diagnostics: [{ code: "MANUAL_REVIEW_REQUIRED", message: "Confirm joint centres and review deformation before using this experimental binding." }],
  });
}

export function fitBindingRig(asset: BindingGLB, command: Extract<HumanoidBindingCommand, { operation: "fit" }>, checkpoint: (phase: string) => void) {
  if (!["t-pose", "a-pose"].includes(command.pose) || !["+z", "-z"].includes(command.forward)) {
    bindingError("BINDING_INPUT_UNSUPPORTED", "Fitting requires an explicit A/T pose and +Z/-Z forward direction.");
  }
  const landmarks = command.landmarks ?? {};
  exactKeys(landmarks, HUMANOID_BONES, "Fitting landmarks");
  for (const [bone, position] of Object.entries(landmarks)) {
    if (!finiteTuple(position, 3)) bindingError("BINDING_RIG_INVALID", "Invalid anatomical landmark.", { bone });
  }
  const { min, max } = asset.inspection.bounds;
  const height = max[1] - min[1];
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const front = command.forward === "+z" ? 1 : -1;
  const point = (x: number, y: number, z = 0): BindingVector3 => [cx + x * height * front, min[1] + y * height, cz + z * height * front];
  const positions: Partial<Record<HumanoidBoneName, BindingVector3>> = {
    hips: point(0, .53), spine: point(0, .63), chest: point(0, .73),
    upperChest: point(0, .80), neck: point(0, .87), head: point(0, .93),
  };
  const armDrop = command.pose === "a-pose" ? .18 : 0;
  // The proportional proposal is checked against actual surface samples below.
  // This is intentionally a draft; insufficient proximity asks for markers.
  for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
    positions[`${side}Shoulder`] = point(sign * .075, .81);
    positions[`${side}UpperArm`] = point(sign * .16, .80);
    positions[`${side}LowerArm`] = point(sign * .30, .80 - armDrop / 2);
    positions[`${side}Hand`] = point(sign * .43, .80 - armDrop);
    positions[`${side}UpperLeg`] = point(sign * .07, .52);
    positions[`${side}LowerLeg`] = point(sign * .075, .29);
    positions[`${side}Foot`] = point(sign * .08, .055);
    positions[`${side}Toes`] = point(sign * .08, .03, .09);
  }
  Object.assign(positions, landmarks);
  const missing: HumanoidBoneName[] = [];
  const available = new Set(Object.keys(positions));
  for (const bone of available as Set<HumanoidBoneName>) {
    const position = positions[bone]!;
    if (position.some((v, i) => v < min[i] - height * .1 || v > max[i] + height * .1)) {
      bindingError("BINDING_RIG_INVALID", "A fitting landmark lies outside the character bounds.", { bone });
    }
    if (landmarks[bone]) continue;
    let closest = Infinity;
    for (const mesh of asset.geometry) {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (i % 12288 === 0) checkpoint("binding-fit-landmarks");
        closest = Math.min(closest, Math.hypot(mesh.positions[i] - position[0], mesh.positions[i + 1] - position[1], mesh.positions[i + 2] - position[2]));
      }
    }
    const radius = /Hand|Foot|Toes/.test(bone) ? .065 : .10;
    if (closest > height * radius) missing.push(bone);
  }
  // The relaxed pose has too many plausible arm configurations to claim an
  // automatic fit without explicit elbow/wrist evidence.
  if (command.pose === "a-pose") {
    for (const bone of ["leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand"] as const) {
      if (!landmarks[bone]) missing.push(bone);
    }
  }
  const width = max[0] - min[0];
  if (command.pose === "t-pose" && (width < height * .75 || width > height * 1.6)) {
    for (const bone of ["leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand"] as const) {
      if (!landmarks[bone]) missing.push(bone);
    }
  }
  if (missing.length) bindingError("BINDING_LANDMARKS_REQUIRED", "The template lacks sufficient geometry evidence. Supply the listed joint centres.", { bones: [...new Set(missing)] });
  const joints: BindingJoint[] = HUMANOID_BONES.flatMap((bone) => positions[bone] ? [{
    bone, parent: bindingParent(bone, available), position: positions[bone]!, rotation: [0, 0, 0, 1],
  }] : []);
  return createBindingRig(asset, joints, "landmark-template-v1");
}

export function editBindingRig(snapshot: HumanoidBindingSnapshot, command: Extract<HumanoidBindingCommand, { operation: "edit-rig" }>) {
  if (!Array.isArray(command.edits) || !command.edits.length || command.edits.length > snapshot.joints.length) {
    bindingError("BINDING_RIG_INVALID", "Joint edits must be a nonempty bounded array.");
  }
  const next = structuredClone(snapshot);
  const changed = new Set<string>();
  for (const edit of command.edits) {
    exactKeys(edit, ["bone", "position", "rotation"], "Joint edit");
    const joint = next.joints.find((candidate) => candidate.bone === edit.bone);
    if (!joint || changed.has(edit.bone) || (edit.position === undefined && edit.rotation === undefined)) {
      bindingError("BINDING_RIG_INVALID", "Invalid or duplicate joint edit.");
    }
    changed.add(edit.bone);
    if (edit.position !== undefined) {
      if (!finiteTuple(edit.position, 3)) bindingError("BINDING_RIG_INVALID", "Invalid joint position.");
      joint.position = [...edit.position];
    }
    if (edit.rotation !== undefined) {
      if (!finiteTuple(edit.rotation, 4) || Math.abs(Math.hypot(...edit.rotation) - 1) > 1e-6) bindingError("BINDING_RIG_INVALID", "Invalid joint rotation.");
      joint.rotation = new Quaternion(...edit.rotation).normalize().toArray();
    }
  }
  validateBindingJoints(next.joints);
  // Absolute world edits do not silently move descendants. Consumers submit
  // every intended joint change. Existing locks remain anatomical constraints.
  if (JSON.stringify(next.joints) !== JSON.stringify(snapshot.joints)) {
    next.weights = null;
    next.skinning = null;
  }
  return sealBindingSnapshot(next);
}

export function bindingLocalTransforms(joints: BindingJoint[]) {
  return joints.map((joint) => {
    const parent = joints.find((candidate) => candidate.bone === joint.parent);
    const position = new Vector3(...joint.position);
    const rotation = new Quaternion(...joint.rotation);
    if (parent) {
      const inverse = new Quaternion(...parent.rotation).invert();
      position.sub(new Vector3(...parent.position)).applyQuaternion(inverse);
      rotation.premultiply(inverse);
    }
    return { translation: position.toArray(), rotation: rotation.toArray() };
  });
}
