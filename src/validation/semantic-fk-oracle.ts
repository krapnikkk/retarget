import { Matrix4, Quaternion, Vector3 } from "three";
import type {
  HumanoidBoneName,
  MotionTrack,
  RetargetedMotionClip,
} from "@/retarget";
import type { HumanoidSemanticRestPose } from "./semantic-motion";

const BASE_SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
const FIXED_RANDOM_SAMPLE_COUNT = 8;

export type SemanticSampledPose = Partial<
  Record<
    HumanoidBoneName,
    {
      rotation?: [number, number, number, number];
      position?: [number, number, number];
    }
  >
>;

export type SemanticWorldBone = {
  matrix: Matrix4;
  position: Vector3;
  quaternion: Quaternion;
};

export function createSemanticSampleTimes({
  actual,
  additionalKeyTimes = [],
  expected,
  restPose,
  rootScale = 1,
  sampleFractions = [],
  worldAxisCorrection = new Quaternion(),
}: {
  actual: RetargetedMotionClip;
  additionalKeyTimes?: readonly number[];
  expected: RetargetedMotionClip;
  restPose?: HumanoidSemanticRestPose;
  rootScale?: number;
  sampleFractions?: readonly number[];
  worldAxisCorrection?: Quaternion;
}) {
  const duration = expected.duration;
  const times = new Set<number>();
  const keyTimes = new Set<number>();
  const add = (time: number) => {
    if (!Number.isFinite(time)) return;
    times.add(roundTime(clamp(time, 0, duration)));
  };
  for (const fraction of [...BASE_SAMPLE_FRACTIONS, ...sampleFractions]) {
    add(clamp(fraction, 0, 1) * duration);
  }
  for (const clip of [expected, actual]) {
    for (const track of clip.tracks) {
      for (const time of track.times) {
        const clamped = roundTime(clamp(time, 0, duration));
        keyTimes.add(clamped);
        add(clamped);
      }
      addFastestRotationIntervalMidpoint(track, add);
    }
  }
  for (const time of additionalKeyTimes) {
    const clamped = roundTime(clamp(time, 0, duration));
    keyTimes.add(clamped);
    add(clamped);
  }

  const epsilon = Math.max(
    Number.EPSILON,
    Math.min(1 / 1000, duration > 0 ? duration / 10_000 : 1 / 1000),
  );
  const orderedKeyTimes = [...keyTimes].sort((left, right) => left - right);
  for (const time of orderedKeyTimes) {
    add(time - epsilon);
    add(time + epsilon);
  }
  for (let index = 1; index < orderedKeyTimes.length; index += 1) {
    add((orderedKeyTimes[index - 1]! + orderedKeyTimes[index]!) / 2);
  }
  for (const fraction of fixedRandomFractions(FIXED_RANDOM_SAMPLE_COUNT)) {
    add(fraction * duration);
  }
  if (restPose) {
    addContactTransitionTimes({
      add,
      clip: expected,
      restPose,
      rootScale,
      sampleTimes: [...times].sort((left, right) => left - right),
      epsilon,
      worldAxisCorrection,
    });
  }

  const output = [...times].sort((left, right) => left - right);
  return output;
}

function addContactTransitionTimes({
  add,
  clip,
  epsilon,
  restPose,
  rootScale,
  sampleTimes,
  worldAxisCorrection,
}: {
  add: (time: number) => void;
  clip: RetargetedMotionClip;
  epsilon: number;
  restPose: HumanoidSemanticRestPose;
  rootScale: number;
  sampleTimes: readonly number[];
  worldAxisCorrection: Quaternion;
}) {
  const contactBones = (["leftFoot", "rightFoot"] as const).filter((bone) =>
    restPose.has(bone),
  );
  if (contactBones.length === 0 || sampleTimes.length < 2) return;
  const groundY = Math.min(
    ...contactBones.map((bone) => restPose.get(bone)!.worldPosition[1]),
  );
  const hipsY = restPose.get("hips")?.worldPosition[1] ?? groundY + 1;
  const thresholdY = groundY + Math.max(0.01, Math.abs(hipsY - groundY) * 0.025);
  const contactAt = (bone: (typeof contactBones)[number], time: number) =>
    (solveSemanticWorldPose({
      clip,
      restPose,
      rootScale,
      time,
      worldAxisCorrection,
    }).get(bone)?.position.y ?? Infinity) <= thresholdY;

  for (const bone of contactBones) {
    let previousTime = sampleTimes[0]!;
    let previousContact = contactAt(bone, previousTime);
    for (let index = 1; index < sampleTimes.length; index += 1) {
      const time = sampleTimes[index]!;
      const contact = contactAt(bone, time);
      if (contact !== previousContact) {
        let left = previousTime;
        let right = time;
        for (let iteration = 0; iteration < 8; iteration += 1) {
          const middle = (left + right) / 2;
          if (contactAt(bone, middle) === previousContact) left = middle;
          else right = middle;
        }
        const transition = (left + right) / 2;
        add(transition - epsilon);
        add(transition);
        add(transition + epsilon);
      }
      previousTime = time;
      previousContact = contact;
    }
  }
}

export function sampleSemanticMotionPose(
  clip: RetargetedMotionClip,
  time: number,
): SemanticSampledPose {
  const sampledTime = clamp(time, 0, clip.duration);
  const pose: SemanticSampledPose = {};
  for (const track of clip.tracks) {
    const value = sampleTrack(track, sampledTime);
    const bonePose = pose[track.bone] ?? {};
    if (track.path === "rotation") {
      bonePose.rotation = value as [number, number, number, number];
    } else {
      bonePose.position = value as [number, number, number];
    }
    pose[track.bone] = bonePose;
  }
  return pose;
}

export function solveSemanticWorldPose({
  clip,
  restPose,
  rootScale = 1,
  time,
  worldAxisCorrection = new Quaternion(),
}: {
  clip: RetargetedMotionClip;
  restPose: HumanoidSemanticRestPose;
  rootScale?: number;
  time: number;
  worldAxisCorrection?: Quaternion;
}) {
  const sampled = sampleSemanticMotionPose(clip, time);
  const restWorld = new Map<HumanoidBoneName, Matrix4>();
  for (const [bone, rest] of restPose) {
    restWorld.set(
      bone,
      new Matrix4().compose(
        new Vector3(...rest.worldPosition),
        new Quaternion(...rest.worldQuaternion).normalize(),
        new Vector3(...(rest.worldScale ?? [1, 1, 1])),
      ),
    );
  }
  const localRest = new Map<HumanoidBoneName, Matrix4>();
  for (const [bone, rest] of restPose) {
    const world = restWorld.get(bone)!;
    const parentWorld = rest.parent ? restWorld.get(rest.parent) : undefined;
    localRest.set(
      bone,
      parentWorld
        ? parentWorld.clone().invert().multiply(world)
        : world.clone(),
    );
  }

  const output = new Map<HumanoidBoneName, SemanticWorldBone>();
  const visiting = new Set<HumanoidBoneName>();
  const solve = (bone: HumanoidBoneName): SemanticWorldBone | null => {
    const cached = output.get(bone);
    if (cached) return cached;
    const rest = restPose.get(bone);
    const local = localRest.get(bone);
    if (!rest || !local) return null;
    if (visiting.has(bone)) {
      throw new Error("Semantic rest pose contains a parent cycle.");
    }
    visiting.add(bone);

    const localPosition = new Vector3();
    const localQuaternion = new Quaternion();
    const localScale = new Vector3();
    local.decompose(localPosition, localQuaternion, localScale);
    const animation = sampled[bone];
    const parentRestWorld = rest.parent ? restWorld.get(rest.parent) : undefined;
    if (animation?.position && bone === "hips") {
      const targetWorldPosition = new Vector3(...rest.worldPosition).add(
        new Vector3(...animation.position)
          .multiplyScalar(rootScale)
          .applyQuaternion(worldAxisCorrection),
      );
      localPosition.copy(
        parentRestWorld
          ? targetWorldPosition.applyMatrix4(parentRestWorld.clone().invert())
          : targetWorldPosition,
      );
    }
    if (animation?.rotation) {
      const parentRestQuaternion = new Quaternion();
      parentRestWorld?.decompose(
        new Vector3(),
        parentRestQuaternion,
        new Vector3(),
      );
      const targetWorldDelta = new Quaternion(...animation.rotation)
        .normalize()
        .premultiply(worldAxisCorrection)
        .multiply(worldAxisCorrection.clone().invert())
        .normalize();
      const localDelta = targetWorldDelta
        .premultiply(parentRestQuaternion.clone().invert())
        .multiply(parentRestQuaternion)
        .normalize();
      localQuaternion.premultiply(localDelta).normalize();
    }
    const animatedLocal = new Matrix4().compose(
      localPosition,
      localQuaternion,
      localScale,
    );
    const parentWorld = rest.parent ? solve(rest.parent)?.matrix : undefined;
    const matrix = parentWorld
      ? parentWorld.clone().multiply(animatedLocal)
      : animatedLocal;
    const position = new Vector3();
    const quaternion = new Quaternion();
    matrix.decompose(position, quaternion, new Vector3());
    const result = { matrix, position, quaternion };
    visiting.delete(bone);
    output.set(bone, result);
    return result;
  };

  for (const bone of restPose.keys()) solve(bone);
  return output;
}

function sampleTrack(track: MotionTrack, time: number) {
  const size = track.path === "rotation" ? 4 : 3;
  if (track.times.length === 0) {
    return track.path === "rotation" ? [0, 0, 0, 1] : [0, 0, 0];
  }
  if (track.times.length === 1 || time <= track.times[0]!) {
    return track.values.slice(0, size);
  }
  const last = track.times.length - 1;
  if (time >= track.times[last]!) {
    return track.values.slice(last * size, (last + 1) * size);
  }
  const leftIndex = findLeftSampleIndex(track.times, time);
  const rightIndex = leftIndex + 1;
  const leftTime = track.times[leftIndex]!;
  const rightTime = track.times[rightIndex]!;
  const alpha = (time - leftTime) / (rightTime - leftTime);
  const left = track.values.slice(leftIndex * size, (leftIndex + 1) * size);
  const right = track.values.slice(rightIndex * size, (rightIndex + 1) * size);
  if (track.path === "translation") {
    return new Vector3(...(left as [number, number, number]))
      .lerp(new Vector3(...(right as [number, number, number])), alpha)
      .toArray();
  }
  const leftQuaternion = new Quaternion(
    ...(left as [number, number, number, number]),
  ).normalize();
  const rightQuaternion = new Quaternion(
    ...(right as [number, number, number, number]),
  ).normalize();
  if (leftQuaternion.dot(rightQuaternion) < 0) {
    rightQuaternion.set(
      -rightQuaternion.x,
      -rightQuaternion.y,
      -rightQuaternion.z,
      -rightQuaternion.w,
    );
  }
  return leftQuaternion.slerp(rightQuaternion, alpha).normalize().toArray();
}

function addFastestRotationIntervalMidpoint(
  track: MotionTrack,
  add: (time: number) => void,
) {
  if (track.path !== "rotation" || track.times.length < 2) return;
  let fastest = -1;
  let midpoint = 0;
  for (let index = 1; index < track.times.length; index += 1) {
    const leftTime = track.times[index - 1]!;
    const rightTime = track.times[index]!;
    const delta = rightTime - leftTime;
    if (delta <= 0) continue;
    const left = new Quaternion().fromArray(track.values, (index - 1) * 4).normalize();
    const right = new Quaternion().fromArray(track.values, index * 4).normalize();
    const speed = left.angleTo(right) / delta;
    if (speed > fastest) {
      fastest = speed;
      midpoint = (leftTime + rightTime) / 2;
    }
  }
  if (fastest >= 0) add(midpoint);
}

function findLeftSampleIndex(times: readonly number[], time: number) {
  let low = 0;
  let high = times.length - 2;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle]! <= time && time < times[middle + 1]!) return middle;
    if (time < times[middle]!) high = middle - 1;
    else low = middle + 1;
  }
  return Math.max(0, Math.min(times.length - 2, low));
}

function fixedRandomFractions(count: number) {
  let state = 0x3d52a11;
  return Array.from({ length: count }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  });
}

function roundTime(value: number) {
  return Number(value.toFixed(9));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
