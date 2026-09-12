import { Euler, Quaternion, Vector3 } from "three";
import { HUMANOID_BONES, type HumanoidBoneName, type SolvedHumanoidMotionClip, type TargetBoundSolvedHumanoidMotionClip } from "./types";
import { getMotionTargetBinding, createCanonicalMotionId } from "./canonical-motion";
import { createCanonicalToTargetWorldCorrection } from "./target-binding";
import { getRigProfile, type RigProfileId } from "@/profiles";
import { sampleMotionClipPose } from "./pose-sampler";
import { RetargetError } from "./errors";
import { assertMotionProcessingBudget, assertSafeCount, DEFAULT_PROCESSING_BUDGET, type ProcessingBudget } from "@/processing-budget";

type Vec3 = [number, number, number];
export type HumanoidPoseCorrection = {
  enabled: boolean;
  bone: HumanoidBoneName;
  startSeconds: number;
  endSeconds: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  weight: number;
} & ({ kind: "fk"; rotationDegrees: Vec3 } | { kind: "ik"; target: Vec3; pole: Vec3 });
export type HumanoidPoseEdit = {
  schemaVersion: 1;
  rigSignature: string;
  restPoseVersion: 1;
  corrections: HumanoidPoseCorrection[];
};
export type HumanoidPoseWarning = { correction: number; code: "IK_UNREACHABLE" | "IK_POLE_DEGENERATE" | "IK_BEND_FLIP"; time: number };
export const HUMANOID_IK_CHAINS = {
  leftHand: ["leftUpperArm", "leftLowerArm", "leftHand"],
  rightHand: ["rightUpperArm", "rightLowerArm", "rightHand"],
  leftFoot: ["leftUpperLeg", "leftLowerLeg", "leftFoot"],
  rightFoot: ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
} as const;
type RestBone = { bone: HumanoidBoneName; parentBone: HumanoidBoneName | null; position: Vec3; rotation: [number, number, number, number]; binding?: { scale: Vec3 } };
function invalid(message: string): never { throw new RetargetError("PROCESSING_OPTION_INVALID", { message }); }
function tuple(value: unknown, n: number, limit: number) {
  return Array.isArray(value) && value.length === n && value.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit);
}
function exact(value: object, keys: string[]) { return Object.keys(value).every(key => keys.includes(key)); }

export function assertHumanoidPoseEdit(value: unknown, duration: number): asserts value is HumanoidPoseEdit {
  const edit = value as HumanoidPoseEdit | null;
  if (!edit || typeof edit !== "object" || Array.isArray(edit) ||
    !exact(edit, ["schemaVersion", "rigSignature", "restPoseVersion", "corrections"]) ||
    edit.schemaVersion !== 1 || edit.restPoseVersion !== 1 || typeof edit.rigSignature !== "string" ||
    edit.rigSignature.length > 40000 || !edit.rigSignature.startsWith("humanoid-rest-v1:") ||
    !Array.isArray(edit.corrections) || edit.corrections.length > 16 || !Number.isFinite(duration) || duration <= 0) invalid("Invalid pose edit v1.");
  for (const c of edit.corrections) {
    if (!c || typeof c !== "object" || Array.isArray(c) ||
      !exact(c, ["kind","enabled","bone","startSeconds","endSeconds","fadeInSeconds","fadeOutSeconds","weight", ...(c.kind === "fk" ? ["rotationDegrees"] : ["target","pole"])]) ||
      typeof c.enabled !== "boolean" || !HUMANOID_BONES.includes(c.bone) ||
      ![c.startSeconds,c.endSeconds,c.fadeInSeconds,c.fadeOutSeconds,c.weight].every(Number.isFinite) ||
      c.startSeconds < 0 || c.endSeconds > duration || c.startSeconds >= c.endSeconds ||
      c.weight < 0 || c.weight > 1 || c.fadeInSeconds < 0 || c.fadeOutSeconds < 0 ||
      c.fadeInSeconds + c.fadeOutSeconds > c.endSeconds - c.startSeconds ||
      (c.startSeconds > 0 && c.fadeInSeconds === 0) || (c.endSeconds < duration && c.fadeOutSeconds === 0) ||
      (c.kind === "fk" ? !tuple(c.rotationDegrees, 3, 180) :
        c.kind !== "ik" || !(c.bone in HUMANOID_IK_CHAINS) || !tuple(c.target, 3, 100000) || !tuple(c.pole, 3, 100000))) {
      invalid("Invalid correction: use finite values, mapped joints, bounded rotation, and fades at interior boundaries.");
    }
  }
}

function readRest(signature: string) {
  try {
    if (typeof signature !== "string" || signature.length > 40000 || !signature.startsWith("humanoid-rest-v1:")) throw new Error();
    const json = JSON.parse(signature.slice("humanoid-rest-v1:".length));
    if (!Array.isArray(json.bones) || !json.bones.length || json.bones.length > HUMANOID_BONES.length) throw new Error();
    const rest = new Map<HumanoidBoneName, RestBone>();
    for (const b of json.bones as RestBone[]) {
      if (!b || !HUMANOID_BONES.includes(b.bone) || rest.has(b.bone) ||
        !tuple(b.position, 3, 100000) || !tuple(b.rotation, 4, 1.001) || Math.hypot(...b.rotation) < 0.99 ||
        (b.parentBone !== null && !HUMANOID_BONES.includes(b.parentBone))) throw new Error();
      rest.set(b.bone, b);
    }
    for (const b of rest.values()) {
      const seen = new Set([b.bone]); let parent = b.parentBone;
      while (parent) {
        if (seen.has(parent) || !rest.has(parent)) throw new Error();
        seen.add(parent); parent = rest.get(parent)!.parentBone;
      }
    }
    return rest;
  } catch { throw new RetargetError("TARGET_RIG_INVALID", { message: "Pose editing requires a valid humanoid rest signature." }); }
}
function prepare(clip: SolvedHumanoidMotionClip) {
  const target = getMotionTargetBinding(clip);
  if (clip.processing.stage !== "solved" || !target?.rigSignature) throw new RetargetError("TARGET_RIG_IDENTITY_MISSING");
  const rest = readRest(target.rigSignature);
  const profile = target.profile ? getRigProfile(target.profile as RigProfileId) : null;
  const axis = createCanonicalToTargetWorldCorrection(profile ?? undefined);
  return { target, rest, axis };
}
type Joint = { local: Quaternion; offset: Vector3; position: Vector3; world: Quaternion };
function poseAt(clip: SolvedHumanoidMotionClip, time: number, rig: ReturnType<typeof prepare>) {
  const sample = sampleMotionClipPose(clip, time, false);
  const joints = new Map<HumanoidBoneName, Joint>();
  for (const [bone, rest] of rig.rest) {
    const parent = rest.parentBone ? rig.rest.get(rest.parentBone)! : undefined;
    const parentRest = parent ? new Quaternion(...parent.rotation).normalize() : new Quaternion();
    const delta = new Quaternion(...(sample[bone]?.rotation ?? [0,0,0,1])).normalize();
    const local = parentRest.clone().invert().multiply(rig.axis).multiply(delta)
      .multiply(rig.axis.clone().invert()).multiply(new Quaternion(...rest.rotation).normalize()).normalize();
    const offset = new Vector3(...rest.position);
    if (bone === "hips" && sample[bone]?.position) {
      const sourceHeight = clip.metadata?.restHipsHeight;
      if (clip.metadata?.rootTranslationSpace === "offset-source-units" && !(sourceHeight && sourceHeight > 0)) throw new RetargetError("ROOT_MOTION_SCALE_UNRESOLVED");
      const v = new Vector3(...sample[bone]!.position!);
      if (clip.metadata?.rootTranslationSpace !== "offset-meters" && clip.metadata?.rootTranslationOrigin !== "root-offset") v.y -= sourceHeight ?? 0;
      v.multiplyScalar(sourceHeight && sourceHeight > 0 ? (rig.target.restHipsHeight ?? rest.position[1]) / sourceHeight : 1).applyQuaternion(rig.axis);
      offset.add(v);
    }
    if (parent) offset.sub(new Vector3(...parent.position)).applyQuaternion(parentRest.invert());
    joints.set(bone, { local, offset, position: new Vector3(), world: new Quaternion() });
  }
  const update = () => {
    const done = new Set<HumanoidBoneName>();
    const visit = (bone: HumanoidBoneName) => {
      if (done.has(bone)) return;
      const joint = joints.get(bone)!; const parent = rig.rest.get(bone)!.parentBone;
      if (parent) {
        visit(parent); const p = joints.get(parent)!;
        joint.world.copy(p.world).multiply(joint.local).normalize();
        joint.position.copy(joint.offset).applyQuaternion(p.world).add(p.position);
      } else { joint.world.copy(joint.local); joint.position.copy(joint.offset); }
      done.add(bone);
    };
    for (const bone of joints.keys()) visit(bone);
  };
  update();
  return { joints, update };
}

/** Target-world positions in the avatar's native units. Local FK uses XYZ Euler degrees after the current local rotation. */
export function sampleHumanoidTargetPose(clip: SolvedHumanoidMotionClip, time: number) {
  assertMotionProcessingBudget(clip);
  if (!Number.isFinite(time) || time < 0 || time > clip.duration) invalid("Pose time is outside the clip.");
  const pose = poseAt(clip, time, prepare(clip));
  return Object.fromEntries([...pose.joints].map(([bone, joint]) => [bone, joint.position.toArray()])) as Partial<Record<HumanoidBoneName, Vec3>>;
}

function influence(c: HumanoidPoseCorrection, time: number) {
  if (!c.enabled || time < c.startSeconds || time > c.endSeconds) return 0;
  return c.weight * Math.min(1, c.fadeInSeconds ? (time-c.startSeconds)/c.fadeInSeconds : 1,
    c.fadeOutSeconds ? (c.endSeconds-time)/c.fadeOutSeconds : 1);
}

/** Solved input only. Foot Cleanup precedes FK, then IK; output remains solved and target-bound. */
export function bakeHumanoidPoseEdits(
  clip: TargetBoundSolvedHumanoidMotionClip, edit: HumanoidPoseEdit,
  budget: ProcessingBudget = DEFAULT_PROCESSING_BUDGET,
): TargetBoundSolvedHumanoidMotionClip {
  assertMotionProcessingBudget(clip, budget);
  assertHumanoidPoseEdit(edit, clip.duration);
  const rig = prepare(clip);
  if (edit.rigSignature !== rig.target.rigSignature) throw new RetargetError("TARGET_RIG_MISMATCH");
  if (clip.metadata?.poseEdit) invalid("Bake from the uncorrected solved clip; do not apply pose edits twice.");
  const changed = new Set<HumanoidBoneName>();
  for (const c of edit.corrections) {
    if (!rig.rest.has(c.bone) || !clip.tracks.some(t => t.bone === c.bone && t.path === "rotation")) invalid("Select a mapped joint with an existing rotation track.");
    if (!c.enabled || c.weight === 0) continue;
    if (c.kind === "fk") changed.add(c.bone);
    else {
      if (rig.target.poseEditingIssue) invalid("IK requires positive uniform bone scale; this avatar has non-uniform or reflected scaling.");
      const chain = HUMANOID_IK_CHAINS[c.bone as keyof typeof HUMANOID_IK_CHAINS];
      if (chain.some(b => !rig.rest.has(b)) || rig.rest.get(chain[1])!.parentBone !== chain[0] ||
        rig.rest.get(chain[2])!.parentBone !== chain[1]) invalid("IK requires a mapped, contiguous upper/lower/end chain.");
      for (const b of chain.slice(0,2)) {
        if (!clip.tracks.some(t => t.bone === b && t.path === "rotation")) invalid("IK chain has missing rotation tracks.");
        changed.add(b);
      }
    }
  }
  if (!changed.size) return clip;
  const times = new Set<number>([0, clip.duration]);
  for (const track of clip.tracks) for (const time of track.times) times.add(time);
  for (const c of edit.corrections) {
    if (!c.enabled || c.weight === 0) continue;
    for (const t of [c.startSeconds,c.startSeconds+c.fadeInSeconds,c.endSeconds-c.fadeOutSeconds,c.endSeconds]) times.add(t);
    const count = Math.ceil((c.endSeconds-c.startSeconds)*clip.fps);
    assertSafeCount(count+1, budget.maxFrames, "pose frames", "refine");
    for (let i=1;i<count;i++) times.add(c.startSeconds + i/clip.fps);
  }
  assertSafeCount(times.size, budget.maxFrames, "pose frames", "refine");
  const preservedSamples = clip.tracks.filter(t => !(t.path === "rotation" && changed.has(t.bone))).reduce((n,t)=>n+t.times.length,0);
  assertSafeCount(preservedSamples + times.size*changed.size, budget.maxTotalSamples, "pose samples", "refine");
  assertSafeCount((preservedSamples + times.size*changed.size)*4, budget.maxGeneratedValues, "pose values", "refine");
  const ordered = [...times].sort((a,b)=>a-b);
  const values = new Map([...changed].map(b => [b, [] as number[]]));
  const warnings: HumanoidPoseWarning[] = [];
  const warn = (correction: number, code: HumanoidPoseWarning["code"], time: number) => {
    if (!warnings.some(w => w.correction === correction && w.code === code)) warnings.push({ correction, code, time });
  };
  for (const time of ordered) {
    const { joints, update } = poseAt(clip, time, rig);
    for (const kind of ["fk", "ik"] as const) for (const [index,c] of edit.corrections.entries()) {
      const weight = influence(c,time);
      if (c.kind !== kind || weight <= 0) continue;
      if (c.kind === "fk") {
        const q = new Quaternion().setFromEuler(new Euler(...c.rotationDegrees.map(v=>v*Math.PI/180) as Vec3, "XYZ"));
        joints.get(c.bone)!.local.multiply(new Quaternion().slerp(q,weight)).normalize(); update();
      } else {
        const [upper,lower,end] = HUMANOID_IK_CHAINS[c.bone as keyof typeof HUMANOID_IK_CHAINS];
        const a=joints.get(upper)!, b=joints.get(lower)!, tip=joints.get(end)!;
        const originalA=a.local.clone(), originalB=b.local.clone();
        const l1=a.position.distanceTo(b.position), l2=b.position.distanceTo(tip.position);
        const direction=new Vector3(...c.target).sub(a.position); const distance=direction.length();
        if (l1 < 1e-7 || l2 < 1e-7) invalid("IK chain contains a zero-length segment.");
        if (distance < 1e-7) { warn(index,"IK_UNREACHABLE",time); continue; }
        direction.normalize();
        const pole=new Vector3(...c.pole).sub(a.position);
        pole.addScaledVector(direction,-pole.dot(direction));
        if (pole.lengthSq()<1e-12) { warn(index,"IK_POLE_DEGENERATE",time); continue; }
        pole.normalize();
        const currentBend=b.position.clone().sub(a.position);
        currentBend.addScaledVector(direction,-currentBend.dot(direction));
        if (currentBend.lengthSq()>1e-10 && currentBend.normalize().dot(pole)<-0.5) warn(index,"IK_BEND_FLIP",time);
        const d=Math.max(Math.abs(l1-l2)+1e-6, Math.min(l1+l2-1e-6,distance));
        if (Math.abs(d-distance)>1e-5) warn(index,"IK_UNREACHABLE",time);
        const along=(l1*l1-l2*l2+d*d)/(2*d);
        const bend=Math.sqrt(Math.max(0,l1*l1-along*along));
        const desiredB=a.position.clone().addScaledVector(direction,along).addScaledVector(pole,bend);
        const desiredEnd=a.position.clone().addScaledVector(direction,d);
        const swing = (bone: HumanoidBoneName, child: HumanoidBoneName, goal: Vector3) => {
          const joint=joints.get(bone)!;
          const rotation=new Quaternion().setFromUnitVectors(joints.get(child)!.position.clone().sub(joint.position).normalize(),goal.clone().sub(joint.position).normalize());
          const world=rotation.multiply(joint.world);
          const parent=rig.rest.get(bone)!.parentBone;
          joint.local.copy(parent ? joints.get(parent)!.world.clone().invert().multiply(world) : world).normalize(); update();
        };
        swing(upper,lower,desiredB); swing(lower,end,desiredEnd);
        a.local.copy(originalA.slerp(a.local,weight)); b.local.copy(originalB.slerp(b.local,weight)); update();
      }
    }
    for (const bone of changed) {
      const rest=rig.rest.get(bone)!; const parent=rest.parentBone ? rig.rest.get(rest.parentBone)! : undefined;
      const delta=(parent ? new Quaternion(...parent.rotation).normalize() : new Quaternion()).multiply(joints.get(bone)!.local)
        .multiply(new Quaternion(...rest.rotation).normalize().invert())
        .premultiply(rig.axis.clone().invert()).multiply(rig.axis).normalize();
      const output=values.get(bone)!;
      if (output.length && new Quaternion().fromArray(output,output.length-4).dot(delta)<0) delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
      output.push(...delta.toArray());
    }
  }
  const tracks=clip.tracks.map(track => track.path === "rotation" && changed.has(track.bone) ?
    { ...track, times: [...ordered], values: values.get(track.bone)! } : track);
  const result = { ...clip, tracks, metadata: { ...clip.metadata, poseEdit: { settings: structuredClone(edit), warnings, resultId: "" } } };
  result.metadata.poseEdit.resultId=createCanonicalMotionId(result);
  assertMotionProcessingBudget(result,budget);
  return result;
}

export function supportsHumanoidPoseExport(format: string) { return ["vrma","motion-json","animated-glb","baked-vrm","vrm-external-vrma"].includes(format); }
export function assertHumanoidPoseExport(clip: import("./types").RetargetedMotionClip, format: string) {
  if (clip.metadata?.poseEdit && !supportsHumanoidPoseExport(format)) throw new RetargetError("UNSUPPORTED_FORMAT", { message: "Target-specific pose edits require VRMA, Motion JSON, or the bound GLB/VRM avatar." });
}
