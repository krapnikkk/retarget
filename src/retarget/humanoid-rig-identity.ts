import {
  HUMANOID_BONES,
  type HumanoidBoneName,
  type TargetBoundSolvedHumanoidMotionClip,
} from "./types";
import { RetargetError } from "./errors";

export type HumanoidRigIdentityBone = {
  bone: HumanoidBoneName;
  parentBone?: HumanoidBoneName;
  worldPosition: readonly [number, number, number];
  worldQuaternion: readonly [number, number, number, number];
  /** Editing identity for SDK-authored binding rigs; absent for legacy rigs. */
  bindingRevision?: string;
  worldScale?: readonly [number, number, number];
};

const SIGNATURE_PREFIX = "humanoid-rest-v1:";

// The canonical evidence is intentionally retained in the signature instead of
// being reduced to a non-cryptographic hash. It is small, serializable, and
// collision-free after the documented numeric normalization.
export function createHumanoidRigSignature(
  profileId: string,
  bones: Iterable<HumanoidRigIdentityBone>,
) {
  const byBone = new Map(
    Array.from(bones, (entry) => [entry.bone, entry] as const),
  );
  const evidence = HUMANOID_BONES.flatMap((bone) => {
    const entry = byBone.get(bone);
    if (!entry) return [];
    return [{
      bone,
      parentBone: entry.parentBone ?? null,
      position: entry.worldPosition.map(normalizeNumber),
      rotation: normalizeQuaternion(entry.worldQuaternion).map(normalizeNumber),
      ...(entry.bindingRevision ? { binding: {
        revision: readBindingRigRevision({ humanoidBindingRigRevision: entry.bindingRevision }),
        scale: (entry.worldScale ?? [1, 1, 1]).map(normalizeNumber),
      } } : {}),
    }];
  });
  return `${SIGNATURE_PREFIX}${JSON.stringify({ profileId, bones: evidence })}`;
}

export function readBindingRigRevision(extras: unknown): string | undefined {
  if (!extras || typeof extras !== "object" || !("humanoidBindingRigRevision" in extras)) return undefined;
  const revision = extras.humanoidBindingRigRevision;
  if (typeof revision !== "string" || !/^[0-9a-f]{64}$/.test(revision)) {
    throw new RetargetError("TARGET_RIG_INVALID", { message: "Invalid humanoid binding rig revision." });
  }
  return revision;
}

export function assertHumanoidTargetIdentity(
  clip: TargetBoundSolvedHumanoidMotionClip,
  actualRigSignature: string,
) {
  if (clip.processing.stage !== "solved" || !clip.target.rigSignature) {
    throw new RetargetError("TARGET_RIG_IDENTITY_MISSING", {
      details: {
        filename: clip.target.filename,
        stage: clip.processing.stage,
      },
    });
  }
  if (clip.target.rigSignature !== actualRigSignature) {
    throw new RetargetError("TARGET_RIG_MISMATCH", {
      details: {
        expectedFilename: clip.target.filename,
        actualRigSignature,
      },
    });
  }
}

function normalizeNumber(value: number) {
  if (!Number.isFinite(value)) {
    throw new RetargetError("TARGET_RIG_INVALID", {
      details: { issue: "non-finite rig transform" },
    });
  }
  const rounded = Math.round(value * 100_000) / 100_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeQuaternion(
  value: readonly [number, number, number, number],
): [number, number, number, number] {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length === 0) {
    throw new RetargetError("TARGET_RIG_INVALID", {
      details: { issue: "invalid rig quaternion" },
    });
  }
  const normalized = value.map((component) => component / length) as [
    number,
    number,
    number,
    number,
  ];
  const firstNonZero = normalized.find((component) => Math.abs(component) > 1e-8);
  return firstNonZero !== undefined && firstNonZero < 0
    ? normalized.map((component) => -component) as typeof normalized
    : normalized;
}
