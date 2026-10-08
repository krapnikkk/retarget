import { Matrix4, Quaternion, Vector3 } from "three";
import type { RigProfile } from "@/profiles";
import { CANONICAL_AXIS_FRAME, createAxisCorrection } from "./coordinate-space";
import type { HumanoidBoneName, MotionTrack, RetargetedMotionClip } from "./types";
import { RetargetError } from "./errors";

export const HUMANOID_TARGET_BINDING_REVISION = 1 as const;

export type TargetBoneRestTransform = {
  parentWorldMatrixInverse: Matrix4;
  parentWorldQuaternionInverse: Quaternion;
  worldPosition: Vector3;
  worldQuaternion: Quaternion;
};

export type TargetRestPose = {
  bones: ReadonlyMap<HumanoidBoneName, TargetBoneRestTransform>;
  profile?: RigProfile;
  restHipsHeight?: number;
};

const MMD_PROFILE_ID = "mmd-body";

/**
 * Rest hips height of a target, as canonical `restHipsHeight` defines it: the
 * hips joint at about leg-root height. MMD rigs map `hips` to センター, which
 * sits well below the leg roots, so MMD targets use the average 左足/右足 height.
 */
export function resolveRestHipsHeight(
  profileId: string | undefined,
  heightOf: (bone: HumanoidBoneName) => number | undefined,
) {
  const positive = (value: number | undefined) =>
    typeof value === "number" && value > 0 ? value : undefined;
  if (profileId === MMD_PROFILE_ID) {
    const legRoots = [heightOf("leftUpperLeg"), heightOf("rightUpperLeg")]
      .map(positive)
      .filter((value): value is number => value !== undefined);
    if (legRoots.length > 0) {
      return legRoots.reduce((sum, value) => sum + value, 0) / legRoots.length;
    }
  }
  return positive(heightOf("hips"));
}

/**
 * VMD root motion is authored in the units of the MMD model it plays on, and
 * MMD applies it unscaled; binding VMD to an MMD target keeps that behavior.
 */
export function isNativeMMDRootMotion(
  clip: RetargetedMotionClip,
  targetProfileId: string | undefined,
) {
  return clip.source.kind === "vmd" && targetProfileId === MMD_PROFILE_ID;
}

export function createCanonicalToTargetWorldCorrection(profile?: RigProfile) {
  return profile
    ? createAxisCorrection(CANONICAL_AXIS_FRAME, profile)
    : new Quaternion();
}

export function bindCanonicalTracksToTargetRest(
  clip: RetargetedMotionClip,
  target: TargetRestPose,
) {
  const canonicalToTargetWorld = createCanonicalToTargetWorldCorrection(
    target.profile,
  );
  const boundTracks: MotionTrack[] = [];
  for (const track of clip.tracks) {
    const rest = target.bones.get(track.bone);
    if (!rest) continue;
    if (track.path === "rotation") {
      boundTracks.push({
        ...track,
        values: bindCanonicalRotationsToRest(
          track.values,
          rest,
          canonicalToTargetWorld,
        ),
      });
      continue;
    }
    if (track.bone !== "hips") continue;

    const sourceRestHipsHeight = clip.metadata?.restHipsHeight;
    if (
      clip.metadata?.rootTranslationSpace === "offset-source-units" &&
      !(sourceRestHipsHeight && sourceRestHipsHeight > 0)
    ) {
      throw new RetargetError("ROOT_MOTION_SCALE_UNRESOLVED", {
        details: {
          sourceKind: clip.source.kind,
          sourceFilename: clip.source.filename,
        },
      });
    }
    const targetRestHipsHeight =
      target.restHipsHeight && target.restHipsHeight > 0
        ? target.restHipsHeight
        : rest.worldPosition.y;
    const native = isNativeMMDRootMotion(clip, target.profile?.id);
    boundTracks.push({
      ...track,
      values: bindCanonicalHipsTranslationsToRest({
        rest,
        rootTranslationSpace: clip.metadata?.rootTranslationSpace,
        rootTranslationOrigin: clip.metadata?.rootTranslationOrigin,
        sourceRestHipsHeight,
        targetRestHipsHeight: native ? sourceRestHipsHeight ?? targetRestHipsHeight : targetRestHipsHeight,
        values: track.values,
        canonicalToTargetWorld,
      }),
    });
  }
  return boundTracks;
}

export function bindCanonicalRotationsToRest(
  values: readonly number[],
  rest: TargetBoneRestTransform,
  canonicalToTargetWorld = new Quaternion(),
) {
  const output = new Array<number>(values.length);
  const parentWorld = rest.parentWorldQuaternionInverse.clone().invert();
  const targetToCanonicalWorld = canonicalToTargetWorld.clone().invert();
  const localRest = rest.parentWorldQuaternionInverse
    .clone()
    .multiply(rest.worldQuaternion)
    .normalize();
  const local = new Quaternion();
  const previous = new Quaternion();
  let hasPrevious = false;
  for (let index = 0; index < values.length; index += 4) {
    local
      .set(
        values[index] ?? 0,
        values[index + 1] ?? 0,
        values[index + 2] ?? 0,
        values[index + 3] ?? 1,
      )
      .normalize();
    local
      .premultiply(canonicalToTargetWorld)
      .multiply(targetToCanonicalWorld)
      .premultiply(rest.parentWorldQuaternionInverse)
      .multiply(parentWorld)
      .multiply(localRest)
      .normalize();
    if (hasPrevious && previous.dot(local) < 0) {
      local.set(-local.x, -local.y, -local.z, -local.w);
    }
    output[index] = local.x;
    output[index + 1] = local.y;
    output[index + 2] = local.z;
    output[index + 3] = local.w;
    previous.copy(local);
    hasPrevious = true;
  }
  return output;
}

export function bindCanonicalRotationDeltasToTargetLocal(
  values: readonly number[],
  parentWorldQuaternionInverse = new Quaternion(),
  canonicalToTargetWorld = new Quaternion(),
) {
  const output = new Array<number>(values.length);
  const localDelta = new Quaternion();
  const previous = new Quaternion();
  let hasPrevious = false;
  const parentWorld = parentWorldQuaternionInverse.clone().invert();
  const targetToCanonicalWorld = canonicalToTargetWorld.clone().invert();
  for (let index = 0; index < values.length; index += 4) {
    localDelta
      .set(
        values[index] ?? 0,
        values[index + 1] ?? 0,
        values[index + 2] ?? 0,
        values[index + 3] ?? 1,
      )
      .normalize()
      .premultiply(canonicalToTargetWorld)
      .multiply(targetToCanonicalWorld)
      .premultiply(parentWorldQuaternionInverse)
      .multiply(parentWorld)
      .normalize();
    if (hasPrevious && previous.dot(localDelta) < 0) {
      localDelta.set(-localDelta.x, -localDelta.y, -localDelta.z, -localDelta.w);
    }
    output[index] = localDelta.x;
    output[index + 1] = localDelta.y;
    output[index + 2] = localDelta.z;
    output[index + 3] = localDelta.w;
    previous.copy(localDelta);
    hasPrevious = true;
  }
  return output;
}

export function bindCanonicalTranslationOffsetsToTargetLocal(
  values: readonly number[],
  parentWorldQuaternionInverse = new Quaternion(),
  canonicalToTargetWorld = new Quaternion(),
  scale = 1,
) {
  const output = new Array<number>(values.length);
  const localOffset = new Vector3();
  for (let index = 0; index < values.length; index += 3) {
    localOffset
      .set(
        values[index] ?? 0,
        values[index + 1] ?? 0,
        values[index + 2] ?? 0,
      )
      .applyQuaternion(canonicalToTargetWorld)
      .applyQuaternion(parentWorldQuaternionInverse)
      .multiplyScalar(scale);
    output[index] = localOffset.x;
    output[index + 1] = localOffset.y;
    output[index + 2] = localOffset.z;
  }
  return output;
}

export function bindCanonicalHipsTranslationsToRest({
  rest,
  rootTranslationSpace,
  rootTranslationOrigin,
  sourceRestHipsHeight,
  targetRestHipsHeight,
  values,
  canonicalToTargetWorld = new Quaternion(),
}: {
  rest: TargetBoneRestTransform;
  rootTranslationSpace?: "offset-meters" | "offset-source-units";
  rootTranslationOrigin?: "root-offset";
  sourceRestHipsHeight?: number;
  targetRestHipsHeight: number;
  values: readonly number[];
  canonicalToTargetWorld?: Quaternion;
}) {
  const scale =
    sourceRestHipsHeight && sourceRestHipsHeight > 0
      ? targetRestHipsHeight / sourceRestHipsHeight
      : 1;
  const output = new Array<number>(values.length);
  const targetWorld = new Vector3();
  for (let index = 0; index < values.length; index += 3) {
    const sourceY = values[index + 1] ?? 0;
    targetWorld
      .set(
        (values[index] ?? 0) * scale,
        (rootTranslationSpace === "offset-meters" ||
        rootTranslationOrigin === "root-offset"
          ? sourceY
          : sourceY - (sourceRestHipsHeight ?? 0)) * scale,
        (values[index + 2] ?? 0) * scale,
      )
      .applyQuaternion(canonicalToTargetWorld)
      .add(rest.worldPosition);
    targetWorld.applyMatrix4(rest.parentWorldMatrixInverse);
    output[index] = targetWorld.x;
    output[index + 1] = targetWorld.y;
    output[index + 2] = targetWorld.z;
  }
  return output;
}
