import { Quaternion, Vector3 } from "three";
import {
  DEFAULT_RETARGET_SOLVE_OPTIONS,
  HUMANOID_BONES,
  REQUIRED_VRM_BONES,
  RetargetError,
  type HumanoidBoneName,
  type CanonicalHumanoidMotionClip,
  type MotionTrack,
  type RetargetSkeletonNode,
  type RetargetSolveOptions,
  type SolvedHumanoidMotionClip,
} from "@/retarget";
import { getRigProfile, type RigProfile, type RigProfileId } from "@/profiles";
import {
  assertMotionProcessingBudget,
  assertRetargetSolveBudget,
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
  profile: RigProfile;
  bones: ReadonlySet<HumanoidBoneName>;
  skeleton: RetargetSkeletonNode;
  restHipsHeight?: number;
};

export type SolveHumanoidMotionInput = {
  motion: CanonicalHumanoidMotionClip;
  mapping?: CustomRigMappingConfig;
  options?: RetargetSolveOptions;
  sourceProfile?: RigProfile;
  targetRig?: HumanoidSolverTargetRig;
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
): SolvedHumanoidMotionClip {
  return solveHumanoidMotion({ motion: clip, mapping: config, options, targetRig });
}

export function solveHumanoidMotion({
  mapping: config = DEFAULT_CUSTOM_RIG_MAPPING_CONFIG,
  motion: clip,
  options = DEFAULT_RETARGET_SOLVE_OPTIONS,
  sourceProfile: sourceProfileInput,
  targetRig,
}: SolveHumanoidMotionInput): SolvedHumanoidMotionClip {
  assertMotionProcessingBudget(clip);
  assertCanonicalSolverInput(clip);
  assertRetargetSolveBudget({
    boneCount: new Set(clip.tracks.map((track) => track.bone)).size,
    duration: clip.duration,
    fps: clip.fps,
    options,
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
  const cleanedTracks = config.enabled && config.footCleanup
    ? applyBasicFootCleanup(optionTracks)
    : optionTracks;
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

  return {
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
          options.rootMotion ? round(value * options.heightScale) : 0,
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
        round(sample.x),
        round(sample.y),
        round(sample.z),
        round(sample.w),
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
  return [
    targetRig.profile.id,
    [...targetRig.bones].sort().join(","),
    targetRig.restHipsHeight ?? "unknown-height",
  ].join(":");
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
  const map = new Map<HumanoidBoneName, HumanoidBoneName>();
  for (const targetBone of targetBones) {
    const override = overrides[targetBone];
    if (override === "none") {
      continue;
    }
    if (override && sourceBones.has(override)) {
      map.set(targetBone, override);
      continue;
    }
    if (sourceBones.has(targetBone)) {
      map.set(targetBone, targetBone);
    }
  }

  return map;
}

export function createCustomChainConfigs(
  preset: CustomChainPreset,
): readonly HumanoidChainConfig[] {
  if (preset === "upper-body") {
    return HUMANOID_CHAIN_CONFIGS.filter(
      (config) =>
        config.id === "spine" ||
        config.id === "leftArm" ||
        config.id === "rightArm",
    );
  }
  if (preset === "lower-body") {
    return HUMANOID_CHAIN_CONFIGS.filter(
      (config) => config.id === "leftLeg" || config.id === "rightLeg",
    );
  }

  return HUMANOID_CHAIN_CONFIGS;
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
        values.push(round(quaternion.x), round(quaternion.y), round(quaternion.z), round(quaternion.w));
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
      values.push(round(vector.x), round(vector.y), round(vector.z));
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

  const coversAnyRequiredBone = REQUIRED_VRM_BONES.some((bone) =>
    mappedTargets.has(bone)
  );
  if (!mappedTargets.has("hips") && !coversAnyRequiredBone) {
    throw new RetargetError("TARGET_MAPPING_INSUFFICIENT", {
      details: { chainPreset, mappedTargets: [...mappedTargets] },
    });
  }

  const selectedChains = createCustomChainConfigs(chainPreset);
  const coversRequiredChain = selectedChains.some((chain) =>
    chain.bones.some(
      (bone) => REQUIRED_VRM_BONES.includes(bone) && mappedTargets.has(bone),
    )
  );
  if (!mappedTargets.has("hips") && !coversRequiredChain) {
    throw new RetargetError("TARGET_REQUIRED_CHAIN_MISSING", {
      details: { chainPreset, mappedTargets: [...mappedTargets] },
    });
  }
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
      values[index] = round((values[index] ?? 0) - minY);
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
    manualOverrides: Object.values(config.boneMap).filter(Boolean).length,
    chainPreset: config.chainPreset,
    footCleanup: config.footCleanup,
  };
}

function trackKey(bone: HumanoidBoneName, path: MotionTrack["path"]) {
  return `${bone}.${path}`;
}

function round(value: number) {
  return Number(value.toFixed(6));
}
