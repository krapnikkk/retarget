export const MOTION_CLIP_SCHEMA_VERSION = 1 as const;

export const HUMANOID_BONES = [
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
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
] as const;

export type HumanoidBoneName = (typeof HUMANOID_BONES)[number];

export type MotionTrackPath = "rotation" | "translation";

export type MotionTrack = {
  bone: HumanoidBoneName;
  path: MotionTrackPath;
  times: number[];
  values: number[];
};

export type CanonicalMotionSourceKind =
  | "mixamo-fbx"
  | "vrma"
  | "bvh"
  | "vmd"
  | "gltf-animation"
  | "actorcore-fbx"
  | "generic-fbx";

export type RetargetTargetKind =
  | "vrm"
  | "gltf-humanoid"
  | "mixamo-rigged"
  | "ready-player-me"
  | "reallusion"
  | "mmd-model"
  | "generic-fbx-avatar";

export type RetargetSkeletonNode = {
  name: string;
  bone?: HumanoidBoneName;
  children: RetargetSkeletonNode[];
};

export type RetargetProfileSummary = {
  id: string;
  label: string;
  restPose: string;
  detectedRestPose: string;
  forwardAxis: string;
  upAxis: string;
  scaleUnit: string;
  rootMotion: string;
};

export type RetargetDiagnostics = {
  solver: {
    id: "canonical-normalization-v1" | "humanoid-custom-v4";
  };
  profiles: {
    source: RetargetProfileSummary;
    target: RetargetProfileSummary;
  };
  skeletons: {
    source: RetargetSkeletonNode;
    target: RetargetSkeletonNode;
  };
  mapping: {
    mappedSourceBones: number;
    mappedTargetBones: number;
    missingRequiredSourceBones: HumanoidBoneName[];
    missingRequiredTargetBones: HumanoidBoneName[];
    unmappedSourceNodes: string[];
    unmappedTargetBones: HumanoidBoneName[];
  };
  pose: {
    restPoseMismatch: boolean;
    armOffsetDegrees: number;
    shoulderCorrectionDegrees: number;
  };
  assumptions: {
    forwardAxisCorrection: string;
    scaleNormalization: string;
    rootMotionNormalization: string;
    fingerTracks: boolean;
    toeTracks: boolean;
  };
  stats: {
    duration: number;
    fps: number;
    sourceHeight: number;
    targetHeight: number;
    rootScale: number;
    rotationTrackCount: number;
    translationTrackCount: number;
  };
};

export type CanonicalMotion = {
  schemaVersion: typeof MOTION_CLIP_SCHEMA_VERSION;
  name: string;
  duration: number;
  fps: number;
  source: {
    kind: CanonicalMotionSourceKind;
    filename: string;
    profile?: string;
  };
  tracks: MotionTrack[];
  createdAt: string;
  diagnostics?: RetargetDiagnostics;
  metadata?: {
    sourceHeight?: number;
    targetHeight?: number;
    rootScale?: number;
    restHipsHeight?: number;
    customMapping?: number;
    customManualOverrides?: number;
    customFootCleanup?: number;
    normalizationVersion?: number;
    canonicalProfile?: string;
    rootTranslationSpace?: "offset-meters" | "offset-source-units";
    rootTranslationOrigin?: "root-offset";
    rootMotionEvidence?: {
      status: "preserved" | "unresolved";
      scaleSource:
        | "profile-unit"
        | "bvh-hierarchy"
        | "mmd-standard-model-preset"
        | "unknown";
      sourceRestHipsHeight?: number;
      coordinateTransform: string;
    };
    sourceRestBinding?: number;
    resampledTracks?: number;
    mmd?: {
      modelName: string;
      sectionCounts: {
        bone: number;
        morph: number;
        camera: number;
        light: number;
        selfShadow: number;
        property: number;
      };
      unmappedBoneNames: string[];
    };
  };
};

export type RetargetTargetBinding = {
  kind: RetargetTargetKind;
  filename: string;
  rigSignature?: string;
  restHipsHeight?: number;
  profile?: string;
  pending?: boolean;
};

export type CanonicalMotionProcessing = {
  stage: "canonical";
  sourceCanonicalId: string;
};

export type SolvedMotionProcessing = {
  stage: "solved";
  sourceCanonicalId: string;
  solverId: "humanoid-custom-v4";
  solverRevision: 4;
  solvePass: 1;
  targetRigRevision?: string;
};

type HumanoidMotionClipBase = CanonicalMotion & {
  target: {
    kind: RetargetTargetKind;
    filename: string;
    rigSignature?: string;
    restHipsHeight?: number;
    profile?: string;
    pending?: boolean;
  };
};

export type CanonicalHumanoidMotionClip = HumanoidMotionClipBase & {
  processing: CanonicalMotionProcessing;
};

export type SolvedHumanoidMotionClip = HumanoidMotionClipBase & {
  processing: SolvedMotionProcessing;
};

export type TargetBoundSolvedHumanoidMotionClip = SolvedHumanoidMotionClip & {
  target: SolvedHumanoidMotionClip["target"] & {
    rigSignature: string;
  };
};

export type RetargetedMotionClip =
  | CanonicalHumanoidMotionClip
  | SolvedHumanoidMotionClip;

export type RetargetSolveOptions = {
  heightScale: number;
  rootMotion: boolean;
  armOffsetDegrees: number;
};

export type RetargetPreviewOptions = {
  playbackSpeed: number;
  loop: boolean;
};

export type RetargetOptions = RetargetSolveOptions & RetargetPreviewOptions;

export const DEFAULT_RETARGET_SOLVE_OPTIONS: RetargetSolveOptions = {
  heightScale: 1,
  rootMotion: true,
  armOffsetDegrees: 0,
};

export const DEFAULT_RETARGET_PREVIEW_OPTIONS: RetargetPreviewOptions = {
  playbackSpeed: 1,
  loop: false,
};

export const DEFAULT_RETARGET_OPTIONS: RetargetOptions = {
  ...DEFAULT_RETARGET_SOLVE_OPTIONS,
  ...DEFAULT_RETARGET_PREVIEW_OPTIONS,
};

export function selectRetargetSolveOptions(
  options: RetargetOptions,
): RetargetSolveOptions {
  return {
    heightScale: options.heightScale,
    rootMotion: options.rootMotion,
    armOffsetDegrees: options.armOffsetDegrees,
  };
}

export function isHumanoidBoneName(value: string): value is HumanoidBoneName {
  return (HUMANOID_BONES as readonly string[]).includes(value);
}
