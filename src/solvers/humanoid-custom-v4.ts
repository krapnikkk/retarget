import { Quaternion, Vector3 } from "three";
import {
  DEFAULT_RETARGET_SOLVE_OPTIONS,
  HUMANOID_BONES,
  REQUIRED_VRM_BONES,
  RetargetError,
  type HumanoidBoneName,
  type HumanoidRestJoints,
  type CanonicalHumanoidMotionClip,
  type MotionTrack,
  type RetargetSkeletonNode,
  type RetargetSolveOptions,
  type SolvedHumanoidMotionClip,
} from "@/retarget";
import { getRigProfile, type RigProfile, type RigProfileId } from "@/profiles";
import { CANONICAL_AXIS_FRAME, createAxisCorrection } from "@/retarget/coordinate-space";
import { isNativeMMDRootMotion } from "@/retarget/target-binding";
import { solveSemanticWorldPose } from "@/validation/semantic-fk-oracle";
import type {
  HumanoidSemanticRestPose,
  SemanticRestBone,
} from "@/validation/semantic-motion";
import {
  assertMotionProcessingBudget,
  assertRetargetSolveBudget,
  type ProcessingBudget,
} from "@/processing-budget";
import {
  applyAxisCorrectionToQuaternion,
  applyAxisCorrectionToVector,
  bakeSwingTwistTracks,
  createRetargetBasis,
  HUMANOID_CHAIN_CONFIGS,
  type HumanoidChainConfig,
} from "./humanoid-solver-primitives";

export type CustomChainPreset = "full-body" | "upper-body" | "lower-body";

export type CustomRigMappingConfig = {
  enabled: boolean;
  sourceProfileOverride?: RigProfileId | "auto";
  targetProfileOverride?: RigProfileId | "auto";
  chainPreset: CustomChainPreset;
  footCleanup: boolean;
  boneMap: Partial<Record<HumanoidBoneName, HumanoidBoneName | "none">>;
};

export type CustomRigMappingReport = {
  mappedBones: number;
  missingRequiredBones: HumanoidBoneName[];
  unmappedTargetBones: HumanoidBoneName[];
  manualOverrides: number;
  chainPreset: CustomChainPreset;
  footCleanup: boolean;
};

export type HumanoidSolverTargetRig = {
  rigSignature: string;
  profile: RigProfile;
  bones: ReadonlySet<HumanoidBoneName>;
  skeleton: RetargetSkeletonNode;
  restHipsHeight?: number;
  /** World rest transforms; required for `grounding: "constant"`. */
  restJoints?: HumanoidRestJoints;
};

export type SolveHumanoidMotionInput = {
  motion: CanonicalHumanoidMotionClip;
  mapping?: CustomRigMappingConfig;
  options?: RetargetSolveOptions;
  sourceProfile?: RigProfile;
  targetRig?: HumanoidSolverTargetRig;
  budget?: ProcessingBudget;
};

export const CUSTOM_MAPPING_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
] as const satisfies readonly HumanoidBoneName[];

export const DEFAULT_CUSTOM_RIG_MAPPING_CONFIG = {
  enabled: true,
  sourceProfileOverride: "auto",
  targetProfileOverride: "auto",
  chainPreset: "full-body",
  footCleanup: false,
  boneMap: {},
} as const satisfies CustomRigMappingConfig;

export function solveHumanoidCustomRigMotion(
  clip: CanonicalHumanoidMotionClip,
  config: CustomRigMappingConfig = DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  targetRig?: HumanoidSolverTargetRig,
  options: RetargetSolveOptions = DEFAULT_RETARGET_SOLVE_OPTIONS,
  budget?: ProcessingBudget,
): SolvedHumanoidMotionClip {
  return solveHumanoidMotion({
    motion: clip,
    mapping: config,
    options,
    targetRig,
    budget,
  });
}

export function solveHumanoidMotion({
  mapping: config = DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  motion: clip,
  options = DEFAULT_RETARGET_SOLVE_OPTIONS,
  sourceProfile: sourceProfileInput,
  targetRig,
  budget,
}: SolveHumanoidMotionInput): SolvedHumanoidMotionClip {
  assertMotionProcessingBudget(clip, budget);
  assertCanonicalSolverInput(clip);
  assertRetargetSolveBudget({
    boneCount: new Set(clip.tracks.map((track) => track.bone)).size,
    duration: clip.duration,
    fps: clip.fps,
    options,
    budget,
  });

  const sourceBones = collectTrackBones(clip.tracks);
  const targetBones = targetRig?.bones ?? collectTargetBones(clip);
  const boneMap = createSemiAutomaticBoneMap({
    overrides: config.boneMap,
    sourceBones,
    targetBones,
  });
  const remappedTracks = config.enabled
    ? remapTracksToTargetBones(clip.tracks, boneMap)
    : clip.tracks;
  if (config.enabled) {
    assertSufficientTargetMapping({
      remappedTracks,
      targetBones,
      chainPreset: config.chainPreset,
    });
  }
  const optionTracks = applyRetargetSolveOptions(remappedTracks, options);
  const footTracks = config.enabled && config.footCleanup
    ? applyBasicFootCleanup(optionTracks)
    : optionTracks;
  const yawedTracks = applyYawOffset(footTracks, options.yawOffsetDegrees ?? 0);
  const grounding = options.grounding === "constant"
    ? applyConstantGrounding(clip, yawedTracks, targetRig)
    : undefined;
  const cleanedTracks = grounding?.tracks ?? yawedTracks;
  const overrideProfiles = resolveOverrideProfiles(
    clip,
    config,
    sourceProfileInput,
    targetRig?.profile,
  );
  const transformedTracks = config.enabled ? applyProfileOverrideTransforms({
    tracks: cleanedTracks,
    ...overrideProfiles,
  }) : cleanedTracks;
  const chainConfigs = createCustomChainConfigs(config.chainPreset);
  const tracks = config.enabled
    ? bakeSwingTwistTracks(transformedTracks, chainConfigs)
    : transformedTracks;
  const report = createCustomMappingReport({
    boneMap,
    config,
    targetBones,
  });

  const solved: SolvedHumanoidMotionClip = {
    ...clip,
    processing: {
      stage: "solved",
      sourceCanonicalId: clip.processing.sourceCanonicalId,
      solverId: "humanoid-custom-v4",
      solverRevision: 4,
      solvePass: 1,
      targetRigRevision: targetRig ? createTargetRigRevision(targetRig) : undefined,
    },
    tracks,
    diagnostics: clip.diagnostics
      ? {
          ...clip.diagnostics,
          solver: {
            id: "humanoid-custom-v4",
          },
          profiles: {
            source: {
              ...clip.diagnostics.profiles.source,
              ...(overrideProfiles.sourceProfile
                ? summarizeProfileForDiagnostics(overrideProfiles.sourceProfile)
                : {}),
            },
            target: {
              ...clip.diagnostics.profiles.target,
              ...(overrideProfiles.targetProfile
                ? summarizeProfileForDiagnostics(overrideProfiles.targetProfile)
                : {}),
            },
          },
          skeletons: targetRig
            ? { ...clip.diagnostics.skeletons, target: targetRig.skeleton }
            : clip.diagnostics.skeletons,
          mapping: {
            ...clip.diagnostics.mapping,
            mappedSourceBones: report.mappedBones,
            mappedTargetBones: report.mappedBones,
            missingRequiredTargetBones: report.missingRequiredBones,
            unmappedTargetBones: report.unmappedTargetBones,
          },
          pose: {
            ...clip.diagnostics.pose,
            armOffsetDegrees: options.armOffsetDegrees,
          },
          assumptions: {
            ...clip.diagnostics.assumptions,
            forwardAxisCorrection: [
              clip.diagnostics.assumptions.forwardAxisCorrection,
              overrideProfiles.description,
              `Solver v4 custom mapping ${report.chainPreset}`,
            ]
              .filter(Boolean)
              .join("; "),
            rootMotionNormalization: [
              options.rootMotion
                ? clip.diagnostics.assumptions.rootMotionNormalization
                : "root motion disabled by solve options",
              options.heightScale !== 1
                ? `user height scale ${options.heightScale}`
                : "",
              report.footCleanup ? "basic foot cleanup applied" : "",
              options.yawOffsetDegrees
                ? `yaw offset ${options.yawOffsetDegrees} degrees`
                : "",
              grounding
                ? `constant grounding offset ${grounding.offset.toFixed(6)} target units`
                : "",
            ]
              .filter(Boolean)
              .join("; "),
          },
          stats: {
            ...clip.diagnostics.stats,
            rootScale: clip.diagnostics.stats.rootScale * options.heightScale,
          },
        }
      : clip.diagnostics,
    metadata: {
      ...clip.metadata,
      customMapping: report.mappedBones,
      customManualOverrides: report.manualOverrides,
      customFootCleanup: report.footCleanup ? 1 : 0,
      rootScale: (clip.metadata?.rootScale ?? 1) * options.heightScale,
      targetHeight: targetRig?.restHipsHeight ?? clip.metadata?.targetHeight,
    },
  };
  assertMotionProcessingBudget(solved, budget);
  return solved;
}

const ARM_OPTION_WEIGHTS: Partial<Record<HumanoidBoneName, number>> = {
  chest: 0.05,
  upperChest: 0.08,
  leftShoulder: 0.35,
  leftUpperArm: 1,
  leftLowerArm: 0.15,
  rightShoulder: 0.35,
  rightUpperArm: 1,
  rightLowerArm: 0.15,
};

function applyRetargetSolveOptions(
  tracks: MotionTrack[],
  options: RetargetSolveOptions,
) {
  if (
    options.heightScale === 1 &&
    options.rootMotion &&
    options.armOffsetDegrees === 0
  ) {
    return tracks;
  }

  return tracks.map((track) => {
    if (track.bone === "hips" && track.path === "translation") {
      return {
        ...track,
        values: track.values.map((value) =>
          options.rootMotion ? value * options.heightScale : 0,
        ),
      };
    }

    const weight = ARM_OPTION_WEIGHTS[track.bone];
    if (
      track.path !== "rotation" ||
      weight === undefined ||
      options.armOffsetDegrees === 0
    ) {
      return track;
    }

    const sideSign = track.bone.startsWith("right") ? -1 : 1;
    const axis =
      track.bone === "chest" || track.bone === "upperChest"
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 0, 1);
    const correction = new Quaternion().setFromAxisAngle(
      axis,
      (options.armOffsetDegrees * weight * sideSign * Math.PI) / 180,
    );
    const values: number[] = [];
    let previous: Quaternion | null = null;
    for (let index = 0; index < track.values.length; index += 4) {
      const sample = new Quaternion(
        track.values[index] ?? 0,
        track.values[index + 1] ?? 0,
        track.values[index + 2] ?? 0,
        track.values[index + 3] ?? 1,
      )
        .multiply(correction)
        .normalize();
      if (previous && previous.dot(sample) < 0) {
        sample.set(-sample.x, -sample.y, -sample.z, -sample.w);
      }
      previous = sample.clone();
      values.push(
        sample.x,
        sample.y,
        sample.z,
        sample.w,
      );
    }
    return { ...track, values };
  });
}

function assertCanonicalSolverInput(
  clip: CanonicalHumanoidMotionClip,
): asserts clip is CanonicalHumanoidMotionClip {
  if (clip.processing?.stage !== "canonical") {
    throw new Error(
      "humanoid-custom-v4 requires a canonical clip; a solved clip cannot enter the solver again.",
    );
  }
}

function createTargetRigRevision(targetRig: HumanoidSolverTargetRig) {
  if (!targetRig.rigSignature) {
    throw new RetargetError("TARGET_RIG_IDENTITY_MISSING");
  }
  return targetRig.rigSignature;
}

export function createSemiAutomaticBoneMap({
  overrides,
  sourceBones,
  targetBones,
}: {
  overrides: CustomRigMappingConfig["boneMap"];
  sourceBones: ReadonlySet<HumanoidBoneName>;
  targetBones: ReadonlySet<HumanoidBoneName>;
}) {
  for (const [targetBone, sourceBone] of Object.entries(overrides)) {
    if (!targetBones.has(targetBone as HumanoidBoneName)) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { sourceBone, targetBone },
        message: `Manual target bone ${targetBone} is not present in the target rig.`,
      });
    }
    if (
      sourceBone !== "none" &&
      (!(HUMANOID_BONES as readonly string[]).includes(sourceBone) ||
        !sourceBones.has(sourceBone as HumanoidBoneName))
    ) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { sourceBone, targetBone },
        message: `Manual source bone ${sourceBone} is not present in the source motion.`,
      });
    }
  }

  const map = new Map<HumanoidBoneName, HumanoidBoneName>();
  const claimedSources = new Map<HumanoidBoneName, HumanoidBoneName>();
  for (const targetBone of targetBones) {
    const override = overrides[targetBone];
    if (override === "none") {
      continue;
    }
    const sourceBone = override && sourceBones.has(override)
      ? override
      : sourceBones.has(targetBone)
        ? targetBone
        : undefined;
    if (!sourceBone) continue;
    const existingTarget = claimedSources.get(sourceBone);
    if (existingTarget) {
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { existingTarget, sourceBone, targetBone },
        message:
          `Source bone ${sourceBone} cannot drive both ${existingTarget} and ${targetBone}.`,
      });
    }
    map.set(targetBone, sourceBone);
    claimedSources.set(sourceBone, targetBone);
  }

  return map;
}

export function createCustomChainConfigs(
  preset: CustomChainPreset,
): readonly HumanoidChainConfig[] {
  switch (preset) {
    case "full-body":
      return HUMANOID_CHAIN_CONFIGS;
    case "upper-body":
      return HUMANOID_CHAIN_CONFIGS.filter(
        (config) =>
          config.id === "spine" ||
          config.id === "leftArm" ||
          config.id === "rightArm",
      );
    case "lower-body":
      return HUMANOID_CHAIN_CONFIGS.filter(
        (config) => config.id === "leftLeg" || config.id === "rightLeg",
      );
    default:
      throw new RetargetError("PROCESSING_OPTION_INVALID", {
        details: { chainPreset: preset },
        message: `Unknown custom chain preset: ${String(preset)}.`,
      });
  }
}

function resolveOverrideProfiles(
  clip: CanonicalHumanoidMotionClip,
  config: CustomRigMappingConfig,
  sourceProfileInput?: RigProfile,
  targetProfileInput?: RigProfile,
) {
  const sourceProfile =
    resolveProfile(config.sourceProfileOverride, undefined) ??
    sourceProfileInput ??
    resolveProfile(undefined, clip.diagnostics?.profiles.source.id);
  const targetProfile =
    resolveProfile(config.targetProfileOverride, undefined) ??
    targetProfileInput ??
    resolveProfile(undefined, clip.diagnostics?.profiles.target.id);
  const hasExplicitOverride =
    (config.sourceProfileOverride && config.sourceProfileOverride !== "auto") ||
    (config.targetProfileOverride && config.targetProfileOverride !== "auto");

  return {
    sourceProfile,
    targetProfile,
    applyTransforms: Boolean(
      !clip.metadata?.normalizationVersion &&
        hasExplicitOverride &&
        sourceProfile &&
        targetProfile,
    ),
    description:
      hasExplicitOverride && sourceProfile && targetProfile
        ? `profile override transform ${sourceProfile.id} -> ${targetProfile.id}`
        : clip.metadata?.normalizationVersion
          ? `source normalized to ${clip.metadata.canonicalProfile ?? "canonical humanoid"}; target profile ${targetProfile?.id ?? "pending"} supplied before mapping`
          : "",
  };
}

function resolveProfile(
  override: RigProfileId | "auto" | undefined,
  fallbackId: string | undefined,
) {
  if (override && override !== "auto") {
    return getRigProfile(override);
  }

  return fallbackId ? getRigProfile(fallbackId as RigProfileId) : null;
}

function applyProfileOverrideTransforms({
  applyTransforms,
  sourceProfile,
  targetProfile,
  tracks,
}: {
  applyTransforms: boolean;
  sourceProfile: RigProfile | null;
  targetProfile: RigProfile | null;
  tracks: MotionTrack[];
}) {
  if (!applyTransforms || !sourceProfile || !targetProfile) {
    return tracks;
  }

  const basis = createRetargetBasis({
    sourceProfile,
    targetProfile,
  });
  const scale = getProfileScaleUnitMultiplier(sourceProfile, targetProfile);

  return tracks.map((track) => {
    if (track.path === "rotation") {
      const values: number[] = [];
      for (let index = 0; index < track.values.length; index += 4) {
        const quaternion = new Quaternion(
          track.values[index] ?? 0,
          track.values[index + 1] ?? 0,
          track.values[index + 2] ?? 0,
          track.values[index + 3] ?? 1,
        ).normalize();
        applyAxisCorrectionToQuaternion(quaternion, basis);
        values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
      }
      return { ...track, values };
    }

    const values: number[] = [];
    for (let index = 0; index < track.values.length; index += 3) {
      const vector = new Vector3(
        track.values[index] ?? 0,
        track.values[index + 1] ?? 0,
        track.values[index + 2] ?? 0,
      ).multiplyScalar(scale);
      applyAxisCorrectionToVector(vector, basis);
      values.push(vector.x, vector.y, vector.z);
    }
    return { ...track, values };
  });
}

function summarizeProfileForDiagnostics(profile: RigProfile) {
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

function getProfileScaleUnitMultiplier(
  sourceProfile: RigProfile,
  targetProfile: RigProfile,
) {
  const sourceUnit = scaleUnitToMeters(sourceProfile.scaleUnit);
  const targetUnit = scaleUnitToMeters(targetProfile.scaleUnit);
  if (!sourceUnit || !targetUnit) {
    return 1;
  }

  return sourceUnit / targetUnit;
}

function scaleUnitToMeters(unit: RigProfile["scaleUnit"]) {
  if (unit === "meters") {
    return 1;
  }
  if (unit === "centimeters") {
    return 0.01;
  }

  return 0;
}

function collectTrackBones(tracks: readonly MotionTrack[]) {
  return new Set(tracks.map((track) => track.bone));
}

function collectTargetBones(clip: CanonicalHumanoidMotionClip) {
  const targetBones = new Set<HumanoidBoneName>();
  collectSkeletonBones(clip.diagnostics?.skeletons.target, targetBones);
  if (targetBones.size === 0) {
    for (const bone of HUMANOID_BONES) {
      targetBones.add(bone);
    }
  }

  return targetBones;
}

function collectSkeletonBones(
  node: RetargetSkeletonNode | undefined,
  output: Set<HumanoidBoneName>,
) {
  if (!node) {
    return;
  }
  if (node.bone) {
    output.add(node.bone);
  }
  for (const child of node.children) {
    collectSkeletonBones(child, output);
  }
}

function remapTracksToTargetBones(
  tracks: MotionTrack[],
  boneMap: ReadonlyMap<HumanoidBoneName, HumanoidBoneName>,
) {
  const tracksBySourceAndPath = new Map<string, MotionTrack>();
  for (const track of tracks) {
    tracksBySourceAndPath.set(trackKey(track.bone, track.path), track);
  }

  const remapped: MotionTrack[] = [];
  const emitted = new Set<string>();
  for (const [targetBone, sourceBone] of boneMap) {
    for (const path of ["rotation", "translation"] as const) {
      const sourceTrack = tracksBySourceAndPath.get(trackKey(sourceBone, path));
      if (!sourceTrack) {
        continue;
      }
      const key = trackKey(targetBone, path);
      if (emitted.has(key)) {
        continue;
      }
      emitted.add(key);
      remapped.push({
        ...sourceTrack,
        bone: targetBone,
        times: [...sourceTrack.times],
        values: [...sourceTrack.values],
      });
    }
  }

  return remapped;
}

function assertSufficientTargetMapping({
  remappedTracks,
  targetBones,
  chainPreset,
}: {
  remappedTracks: readonly MotionTrack[];
  targetBones: ReadonlySet<HumanoidBoneName>;
  chainPreset: CustomChainPreset;
}) {
  if (remappedTracks.length === 0) {
    throw new RetargetError("TARGET_MAPPING_EMPTY", {
      details: { chainPreset },
    });
  }

  const mappedTargets = new Set(remappedTracks.map((track) => track.bone));
  const unexpectedTargets = [...mappedTargets].filter(
    (bone) => !targetBones.has(bone),
  );
  if (unexpectedTargets.length > 0) {
    throw new RetargetError("TARGET_MAPPING_INSUFFICIENT", {
      details: { chainPreset, unexpectedTargets },
    });
  }

  const requiredGroups: readonly (readonly HumanoidBoneName[])[] =
    chainPreset === "full-body"
      ? [
          ["hips"],
          ["spine", "chest", "upperChest"],
          ["leftUpperArm"],
          ["rightUpperArm"],
          ["leftUpperLeg"],
          ["rightUpperLeg"],
        ]
      : chainPreset === "upper-body"
        ? [
            ["hips", "spine", "chest", "upperChest"],
            ["leftUpperArm"],
            ["rightUpperArm"],
          ]
        : [
            ["hips"],
            ["leftUpperLeg"],
            ["rightUpperLeg"],
          ];
  const missingGroups = requiredGroups.filter((group) =>
    !group.some((bone) => mappedTargets.has(bone))
  );
  if (missingGroups.length > 0) {
    throw new RetargetError("TARGET_REQUIRED_CHAIN_MISSING", {
      details: {
        chainPreset,
        mappedTargets: [...mappedTargets],
        missingGroups,
      },
    });
  }
}

// Rotates the whole motion about canonical up (+Y): root orientation and root
// travel turn together, so the body keeps walking the way it faces.
function applyYawOffset(tracks: MotionTrack[], degrees: number) {
  if (degrees === 0) return tracks;
  const yaw = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    (degrees * Math.PI) / 180,
  );
  return tracks.map((track) => {
    if (track.bone !== "hips") return track;
    const values = [...track.values];
    if (track.path === "translation") {
      const offset = new Vector3();
      for (let index = 0; index + 2 < values.length; index += 3) {
        offset.fromArray(values, index).applyQuaternion(yaw).toArray(values, index);
      }
    } else {
      const rotation = new Quaternion();
      for (let index = 0; index + 3 < values.length; index += 4) {
        rotation.fromArray(values, index).premultiply(yaw).normalize().toArray(values, index);
      }
    }
    return { ...track, values };
  });
}

const GROUNDING_FOOT_BONES = ["leftFoot", "rightFoot", "leftToes", "rightToes"] as const;

// One vertical root offset so the lowest foot joint over the clip sits at the
// target's rest foot height. Computed in target units on the target skeleton
// with the root scale binding applies, then stored in source units.
function applyConstantGrounding(
  clip: CanonicalHumanoidMotionClip,
  tracks: MotionTrack[],
  targetRig: HumanoidSolverTargetRig | undefined,
) {
  const restPose = targetRig?.restJoints
    ? createSemanticRestPose(targetRig.restJoints, targetRig.skeleton)
    : undefined;
  const feet = GROUNDING_FOOT_BONES.filter((bone) => restPose?.has(bone));
  if (!targetRig || !restPose || !restPose.has("hips") || feet.length === 0) {
    throw new RetargetError("PROCESSING_OPTION_INVALID", {
      details: {
        option: "grounding",
        reason: "constant grounding requires target rest joints with hips and feet",
      },
    });
  }
  const sourceRestHipsHeight = clip.metadata?.restHipsHeight;
  if (
    clip.metadata?.rootTranslationSpace === "offset-source-units" &&
    !(sourceRestHipsHeight && sourceRestHipsHeight > 0)
  ) {
    throw new RetargetError("ROOT_MOTION_SCALE_UNRESOLVED", {
      details: { sourceKind: clip.source.kind, sourceFilename: clip.source.filename },
    });
  }
  const rootScale =
    !isNativeMMDRootMotion(clip, targetRig.profile.id) &&
    targetRig.restHipsHeight &&
    sourceRestHipsHeight &&
    sourceRestHipsHeight > 0
      ? targetRig.restHipsHeight / sourceRestHipsHeight
      : 1;
  const motion = { ...clip, tracks };
  const worldAxisCorrection = createAxisCorrection(CANONICAL_AXIS_FRAME, targetRig.profile);
  const frameCount = Math.max(2, Math.ceil(clip.duration * clip.fps) + 1);
  let lowest = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const pose = solveSemanticWorldPose({
      clip: motion,
      restPose,
      rootScale,
      time: Math.min(clip.duration, frame / clip.fps),
      worldAxisCorrection,
    });
    for (const bone of feet) {
      const y = pose.get(bone)?.position.y;
      if (y !== undefined) lowest = Math.min(lowest, y);
    }
  }
  const restLowest = Math.min(...feet.map((bone) => restPose.get(bone)!.worldPosition[1]));
  const offset = Number.isFinite(lowest) ? restLowest - lowest : 0;
  const sourceOffset = offset / rootScale;
  const hasRootTranslation = tracks.some(
    (track) => track.bone === "hips" && track.path === "translation",
  );
  const grounded = hasRootTranslation
    ? tracks.map((track) =>
        track.bone === "hips" && track.path === "translation"
          ? {
              ...track,
              values: track.values.map((value, index) =>
                index % 3 === 1 ? value + sourceOffset : value,
              ),
            }
          : track,
      )
    : [
        ...tracks,
        {
          bone: "hips" as const,
          path: "translation" as const,
          times: [0, clip.duration],
          values: [0, sourceOffset, 0, 0, sourceOffset, 0],
        },
      ];
  return { tracks: grounded, offset };
}

function createSemanticRestPose(
  joints: HumanoidRestJoints,
  skeleton: RetargetSkeletonNode,
): HumanoidSemanticRestPose {
  const parents = new Map<HumanoidBoneName, HumanoidBoneName | undefined>();
  const visit = (node: RetargetSkeletonNode, parent?: HumanoidBoneName) => {
    const bone = node.bone;
    if (bone) parents.set(bone, parent);
    for (const child of node.children) visit(child, bone ?? parent);
  };
  visit(skeleton);
  const restPose = new Map<HumanoidBoneName, SemanticRestBone>();
  for (const [bone, joint] of Object.entries(joints) as Array<
    [HumanoidBoneName, NonNullable<HumanoidRestJoints[HumanoidBoneName]>]
  >) {
    const parent = parents.get(bone);
    restPose.set(bone, {
      parent: parent && joints[parent] ? parent : undefined,
      worldPosition: joint.position,
      worldQuaternion: joint.rotation,
    });
  }
  return restPose;
}

function applyBasicFootCleanup(tracks: MotionTrack[]) {
  return tracks.map((track) => {
    if (track.bone !== "hips" || track.path !== "translation") {
      return track;
    }

    const values = [...track.values];
    const yValues: number[] = [];
    for (let index = 1; index < values.length; index += 3) {
      yValues.push(values[index] ?? 0);
    }
    const minY = minimum(yValues);
    if (!Number.isFinite(minY) || minY >= 0) {
      return track;
    }

    for (let index = 1; index < values.length; index += 3) {
      values[index] = (values[index] ?? 0) - minY;
    }

    return {
      ...track,
      values,
    };
  });
}

function minimum(values: readonly number[]) {
  let result = Infinity;
  for (const value of values) result = Math.min(result, value);
  return result;
}

function createCustomMappingReport({
  boneMap,
  config,
  targetBones,
}: {
  boneMap: ReadonlyMap<HumanoidBoneName, HumanoidBoneName>;
  config: CustomRigMappingConfig;
  targetBones: ReadonlySet<HumanoidBoneName>;
}): CustomRigMappingReport {
  const mappedTargets = new Set(boneMap.keys());
  return {
    mappedBones: mappedTargets.size,
    missingRequiredBones: REQUIRED_VRM_BONES.filter(
      (bone) => targetBones.has(bone) && !mappedTargets.has(bone),
    ),
    unmappedTargetBones: HUMANOID_BONES.filter(
      (bone) => targetBones.has(bone) && !mappedTargets.has(bone),
    ),
    manualOverrides: Object.values(config.boneMap).filter(
      (value) => value && value !== "none",
    ).length,
    chainPreset: config.chainPreset,
    footCleanup: config.footCleanup,
  };
}

function trackKey(bone: HumanoidBoneName, path: MotionTrack["path"]) {
  return `${bone}.${path}`;
}
