import {
  HUMANOID_BONES,
  MOTION_CLIP_SCHEMA_VERSION,
  REQUIRED_VRM_BONES,
  createCanonicalHumanoidMotionClip,
  type CanonicalMotion,
  type CanonicalHumanoidMotionClip,
  type CanonicalMotionSourceKind,
  type HumanoidBoneName,
  type MotionTrack,
  type RetargetDiagnostics,
  type RetargetSkeletonNode,
} from "@/retarget";
import { VRM_HUMANOID_PROFILE, type RigProfile } from "@/profiles";
import { normalizeBoneName } from "@/core/bone-name";
import {
  normalizeSourceMotionToCanonical,
  type SourceBoneRestTransform,
  type SourceRotationSemantics,
  type SourceTranslationSemantics,
} from "@/retarget/source-normalization";

export type ImportedHumanoidMotionInput = {
  kind: CanonicalMotionSourceKind;
  filename: string;
  profile: RigProfile;
  tracks: MotionTrack[];
  duration?: number;
  fps?: number;
  restHipsHeight?: number;
  rootName?: string;
  restTransforms?: ReadonlyMap<HumanoidBoneName, SourceBoneRestTransform>;
  rotationSemantics?: SourceRotationSemantics;
  translationSemantics?: SourceTranslationSemantics;
  resampledTrackCount?: number;
  metadata?: CanonicalMotion["metadata"];
  rootMotionEvidence?: NonNullable<CanonicalMotion["metadata"]>["rootMotionEvidence"];
};

export function createImportedHumanoidMotionClip({
  duration,
  filename,
  fps,
  kind,
  metadata,
  profile,
  restHipsHeight,
  restTransforms,
  rootName,
  rotationSemantics,
  resampledTrackCount = 0,
  rootMotionEvidence,
  tracks,
  translationSemantics,
}: ImportedHumanoidMotionInput): CanonicalHumanoidMotionClip {
  const normalized = normalizeSourceMotionToCanonical({
    profile,
    restTransforms,
    rotationSemantics,
    tracks,
    translationSemantics,
  });
  const canonicalTracks = normalizeImportedTracks(normalized.tracks);
  const canonicalRestHipsHeight =
    restHipsHeight && restHipsHeight > 0
      ? restHipsHeight * normalized.scaleToMeters
      : undefined;
  const safeDuration =
    duration && duration > 0 ? duration : estimateDurationFromTracks(canonicalTracks);
  const safeFps = fps && fps > 0 ? fps : estimateFPSFromTracks(canonicalTracks);
  const canonicalMotion = {
    schemaVersion: MOTION_CLIP_SCHEMA_VERSION,
    name: stripExtension(filename),
    duration: Math.max(safeDuration, 1 / safeFps),
    fps: safeFps,
    source: {
      kind,
      filename,
      profile: profile.id,
    },
    tracks: canonicalTracks,
    diagnostics: createImportedMotionDiagnostics({
      duration: Math.max(safeDuration, 1 / safeFps),
      fps: safeFps,
      profile,
      normalization: normalized,
      rootMotionEvidence,
      rootName,
      tracks: canonicalTracks,
    }),
    metadata: {
      ...metadata,
      restHipsHeight: canonicalRestHipsHeight,
      normalizationVersion: 1,
      canonicalProfile: normalized.canonicalProfile.id,
      rootTranslationSpace: normalized.unitScaleKnown
        ? "offset-meters"
        : "offset-source-units",
      rootTranslationOrigin: "root-offset",
      rootMotionEvidence: rootMotionEvidence ?? {
        status:
          normalized.unitScaleKnown || canonicalRestHipsHeight
            ? "preserved"
            : "unresolved",
        scaleSource: normalized.unitScaleKnown ? "profile-unit" : "unknown",
        sourceRestHipsHeight: canonicalRestHipsHeight,
        coordinateTransform: normalized.axisCorrectionApplied
          ? `${profile.forwardAxis} source forward normalized to ${normalized.canonicalProfile.forwardAxis}`
          : `${profile.forwardAxis} source forward retained in canonical basis`,
      },
      sourceRestBinding: normalized.usedRestTransforms ? 1 : 0,
      resampledTracks: resampledTrackCount,
    },
  } satisfies CanonicalMotion;

  return createCanonicalHumanoidMotionClip(canonicalMotion);
}

export function normalizeImportedTracks(tracks: MotionTrack[]) {
  return tracks
    .filter((track) => track.times.length > 0 && track.values.length > 0)
    .map((track) => ({
      ...track,
      times: [...track.times],
      values: [...track.values],
    }));
}

export function resolveProfileBoneName(
  profile: RigProfile,
  name: string,
): HumanoidBoneName | null {
  const normalized = normalizeBoneAlias(name);
  const matched = profile.bones.find((bone) =>
    bone.aliases.some((alias) => normalizeBoneAlias(alias) === normalized),
  );

  return matched?.humanoid ?? null;
}

export function normalizeBoneAlias(name: string) {
  return normalizeBoneName(name);
}

function createImportedMotionDiagnostics({
  duration,
  fps,
  profile,
  normalization,
  rootMotionEvidence,
  rootName,
  tracks,
}: {
  duration: number;
  fps: number;
  profile: RigProfile;
  normalization: ReturnType<typeof normalizeSourceMotionToCanonical>;
  rootMotionEvidence?: ImportedHumanoidMotionInput["rootMotionEvidence"];
  rootName?: string;
  tracks: MotionTrack[];
}): RetargetDiagnostics {
  const trackedBones = new Set(tracks.map((track) => track.bone));
  const missingRequiredBones = REQUIRED_VRM_BONES.filter(
    (bone) => !trackedBones.has(bone),
  );
  const rotationTrackCount = tracks.filter((track) => track.path === "rotation").length;
  const translationTrackCount = tracks.filter(
    (track) => track.path === "translation",
  ).length;

  return {
    solver: {
      id: "canonical-normalization-v1",
    },
    profiles: {
      source: summarizeProfile(profile),
      target: summarizeProfile(VRM_HUMANOID_PROFILE),
    },
    skeletons: {
      source: createFlatSkeletonTree(rootName ?? `${profile.label} tracks`, trackedBones),
      target: createFlatSkeletonTree("pending VRM humanoid", trackedBones),
    },
    mapping: {
      mappedSourceBones: trackedBones.size,
      mappedTargetBones: trackedBones.size,
      missingRequiredSourceBones: missingRequiredBones,
      missingRequiredTargetBones: [],
      unmappedSourceNodes: [],
      unmappedTargetBones: HUMANOID_BONES.filter((bone) => !trackedBones.has(bone)),
    },
    pose: {
      restPoseMismatch: profile.restPose !== "normalized",
      armOffsetDegrees: 0,
      shoulderCorrectionDegrees: 0,
    },
    assumptions: {
      forwardAxisCorrection: normalization.axisCorrectionApplied
        ? `${profile.forwardAxis} source axis normalized to ${normalization.canonicalProfile.forwardAxis} canonical axis`
        : `${profile.forwardAxis} source axis already matches the canonical basis`,
      scaleNormalization: normalization.unitScaleKnown
        ? `${profile.scaleUnit} source scaled to meters by ${normalization.scaleToMeters}`
        : "source unit scale is unknown; root translation remains in source units until binding evidence is available",
      rootMotionNormalization: tracks.some(
        (track) => track.bone === "hips" && track.path === "translation",
      )
        ? rootMotionEvidence?.status === "preserved"
          ? `${profile.rootMotion} root translation imported with ${rootMotionEvidence.scaleSource} scale evidence; ${rootMotionEvidence.coordinateTransform}`
          : `${profile.rootMotion} root translation imported${rootMotionEvidence?.status === "unresolved" ? "; target binding remains unresolved because source scale evidence is missing" : ""}`
        : "no root translation track",
      fingerTracks: tracks.some(isFingerTrack),
      toeTracks: tracks.some((track) => track.bone.endsWith("Toes")),
    },
    stats: {
      duration,
      fps,
      sourceHeight: 0,
      targetHeight: 0,
      rootScale: 1,
      rotationTrackCount,
      translationTrackCount,
    },
  };
}

function summarizeProfile(profile: RigProfile) {
  return {
    id: profile.id,
    label: profile.label,
    restPose: profile.restPose,
    detectedRestPose: profile.restPose,
    forwardAxis: profile.forwardAxis,
    upAxis: profile.upAxis,
    scaleUnit: profile.scaleUnit,
    rootMotion: profile.rootMotion,
  };
}

function createFlatSkeletonTree(
  name: string,
  trackedBones: ReadonlySet<HumanoidBoneName>,
): RetargetSkeletonNode {
  return {
    name,
    children: HUMANOID_BONES.filter((bone) => trackedBones.has(bone)).map((bone) => ({
      name: bone,
      bone,
      children: [],
    })),
  };
}

function isFingerTrack(track: MotionTrack) {
  return (
    track.bone.includes("Thumb") ||
    track.bone.includes("Index") ||
    track.bone.includes("Middle") ||
    track.bone.includes("Ring") ||
    track.bone.includes("Little")
  );
}

function estimateDurationFromTracks(tracks: MotionTrack[]) {
  return Math.max(
    0,
    ...tracks.map((track) => track.times[track.times.length - 1] ?? 0),
  );
}

function estimateFPSFromTracks(tracks: MotionTrack[]) {
  const deltas = tracks
    .flatMap((track) =>
      track.times
        .slice(1)
        .map((time, index) => time - (track.times[index] ?? time))
        .filter((delta) => delta > 1e-6),
    )
    .sort((left, right) => left - right);

  if (deltas.length === 0) {
    return 30;
  }

  const median = deltas[Math.floor(deltas.length / 2)] ?? 1 / 30;
  return Math.min(Math.max(Math.round(1 / median), 1), 120);
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, "") || "imported-motion";
}
