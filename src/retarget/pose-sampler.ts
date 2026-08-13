import type {
  HumanoidBoneName,
  MotionTrack,
  RetargetedMotionClip,
} from "./types";

type Vec3Tuple = [number, number, number];
type QuatTuple = [number, number, number, number];

export type SampledHumanoidPose = Partial<
  Record<
    HumanoidBoneName,
    {
      rotation?: QuatTuple;
      position?: Vec3Tuple;
    }
  >
>;

export function sampleMotionClipPose(
  clip: RetargetedMotionClip,
  time: number,
  loop = true,
): SampledHumanoidPose {
  const sampledTime = normalizeMotionTime(time, clip.duration, loop);
  const pose: SampledHumanoidPose = {};

  for (const track of clip.tracks) {
    const bonePose = pose[track.bone] ?? {};
    if (track.path === "rotation") {
      bonePose.rotation = sampleRotationTrack(track, sampledTime);
    } else {
      bonePose.position = sampleTranslationTrack(track, sampledTime);
    }
    pose[track.bone] = bonePose;
  }

  return pose;
}

export function sampleMotionClipPoseForAvatarPreview(
  clip: RetargetedMotionClip,
  time: number,
  loop = true,
  options: { vrm0FacingCorrection?: boolean } = {},
): SampledHumanoidPose {
  const pose = sampleMotionClipPose(clip, time, loop);

  if (clip.source.kind !== "vrma" || !options.vrm0FacingCorrection) {
    return pose;
  }

  const hips = pose.hips;
  if (!hips?.position) return pose;

  return {
    ...pose,
    hips: {
      ...hips,
      position: [-hips.position[0], hips.position[1], -hips.position[2]],
    },
  };
}

export function normalizeMotionTime(
  time: number,
  duration: number,
  loop: boolean,
) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  if (!loop) return clamp(time, 0, duration);
  const wrapped = time % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}

function sampleTranslationTrack(track: MotionTrack, time: number): Vec3Tuple {
  if (track.times.length === 0) return [0, 0, 0];
  const { leftIndex, rightIndex, ratio } = findSampleWindow(track.times, time);
  const left = readVec3(track.values, leftIndex * 3);
  if (leftIndex === rightIndex) return left;
  return lerpVec3(left, readVec3(track.values, rightIndex * 3), ratio);
}

function sampleRotationTrack(track: MotionTrack, time: number): QuatTuple {
  if (track.times.length === 0) return [0, 0, 0, 1];
  const { leftIndex, rightIndex, ratio } = findSampleWindow(track.times, time);
  const left = readQuaternion(track.values, leftIndex * 4);
  if (leftIndex === rightIndex) return normalizeQuaternion(left);
  return slerpQuaternion(
    left,
    readQuaternion(track.values, rightIndex * 4),
    ratio,
  );
}

function findSampleWindow(times: number[], time: number) {
  const sampleCount = times.length;
  if (sampleCount <= 1) return { leftIndex: 0, rightIndex: 0, ratio: 0 };

  const firstTime = times[0] ?? 0;
  if (time <= firstTime) return { leftIndex: 0, rightIndex: 0, ratio: 0 };

  const lastIndex = sampleCount - 1;
  const lastTime = times[lastIndex] ?? firstTime;
  if (time >= lastTime) {
    return { leftIndex: lastIndex, rightIndex: lastIndex, ratio: 0 };
  }

  const leftIndex = findLeftSampleIndex(times, time);
  const rightIndex = leftIndex + 1;
  const leftTime = times[leftIndex] ?? firstTime;
  const rightTime = times[rightIndex] ?? leftTime;
  return {
    leftIndex,
    rightIndex,
    ratio:
      rightTime === leftTime
        ? 0
        : clamp((time - leftTime) / (rightTime - leftTime), 0, 1),
  };
}

function findLeftSampleIndex(times: number[], time: number) {
  let low = 0;
  let high = times.length - 2;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = times[mid];
    const nextTime = times[mid + 1];
    if (midTime === undefined || nextTime === undefined) break;
    if (midTime <= time && time < nextTime) return mid;
    if (time < midTime) high = mid - 1;
    else low = mid + 1;
  }

  return Math.max(0, Math.min(times.length - 2, low));
}

function readVec3(values: number[], offset: number): Vec3Tuple {
  return [values[offset] ?? 0, values[offset + 1] ?? 0, values[offset + 2] ?? 0];
}

function readQuaternion(values: number[], offset: number): QuatTuple {
  return [
    values[offset] ?? 0,
    values[offset + 1] ?? 0,
    values[offset + 2] ?? 0,
    values[offset + 3] ?? 1,
  ];
}

function lerpVec3(left: Vec3Tuple, right: Vec3Tuple, ratio: number): Vec3Tuple {
  return [
    left[0] + (right[0] - left[0]) * ratio,
    left[1] + (right[1] - left[1]) * ratio,
    left[2] + (right[2] - left[2]) * ratio,
  ];
}

function slerpQuaternion(
  left: QuatTuple,
  right: QuatTuple,
  ratio: number,
): QuatTuple {
  const [x1, y1, z1, w1] = left;
  let [x2, y2, z2, w2] = right;
  let cosHalfTheta = x1 * x2 + y1 * y2 + z1 * z2 + w1 * w2;

  if (cosHalfTheta < 0) {
    x2 = -x2;
    y2 = -y2;
    z2 = -z2;
    w2 = -w2;
    cosHalfTheta = -cosHalfTheta;
  }

  if (cosHalfTheta >= 1) return normalizeQuaternion(left);
  if (cosHalfTheta > 0.9995) {
    return normalizeQuaternion([
      x1 + (x2 - x1) * ratio,
      y1 + (y2 - y1) * ratio,
      z1 + (z2 - z1) * ratio,
      w1 + (w2 - w1) * ratio,
    ]);
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);
  const leftRatio = Math.sin((1 - ratio) * halfTheta) / sinHalfTheta;
  const rightRatio = Math.sin(ratio * halfTheta) / sinHalfTheta;
  return normalizeQuaternion([
    x1 * leftRatio + x2 * rightRatio,
    y1 * leftRatio + y2 * rightRatio,
    z1 * leftRatio + z2 * rightRatio,
    w1 * leftRatio + w2 * rightRatio,
  ]);
}

function normalizeQuaternion(value: QuatTuple): QuatTuple {
  const length = Math.hypot(...value);
  if (length === 0) return [0, 0, 0, 1];
  return [
    value[0] / length,
    value[1] / length,
    value[2] / length,
    value[3] / length,
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
