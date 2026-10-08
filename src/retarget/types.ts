export const MOTION_CLIP_SCHEMA_VERSION = 2 as const;
export const MOTION_ARTIFACT_ENVELOPE_SCHEMA_VERSION = 1 as const;

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
  | "generic-fbx"
  | "video-pose";

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
    videoPose?: {
      schema: "video-motion.pose-evidence.v1";
      backend: "mediapipe-pose-landmarker";
      backendVersion: "1.0.1";
      sampledFrameCount: number;
      outputFrameCount: number;
      detectedFrameCount: number;
      interpolatedFrameCount: number;
      invalidFrameCount: number;
      detectionRate: number;
      averageConfidence: number;
      qualityScore: number;
      inferenceFps: number;
      outputFps: number;
      mirror: boolean;
      groundAligned: boolean;
      footLock: boolean;
    };
  };
};

export type RetargetTargetBinding = {
  kind: RetargetTargetKind;
  filename: string;
  rigSignature?: string;
  restHipsHeight?: number;
  profile?: string;
};

export type MotionArtifactEnvelope = {
  schemaVersion: typeof MOTION_ARTIFACT_ENVELOPE_SCHEMA_VERSION;
  artifactId: string;
  createdAt: string;
  toolVersion: string;
  sourceHash: string;
  motion: CanonicalMotion;
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

export type CanonicalHumanoidMotionClip = CanonicalMotion & {
  processing: CanonicalMotionProcessing;
};

export type SolvedHumanoidMotionClip = CanonicalMotion & {
  processing: SolvedMotionProcessing;
};

export type TargetBoundSolvedHumanoidMotionClip = SolvedHumanoidMotionClip & {
  target: RetargetTargetBinding & {
    rigSignature: string;
  };
};

export type RetargetedMotionClip =
  | CanonicalHumanoidMotionClip
  | SolvedHumanoidMotionClip
  | TargetBoundSolvedHumanoidMotionClip;

export type RetargetSolveOptions = {
  heightScale: number;
  rootMotion: boolean;
  armOffsetDegrees: number;
  /**
   * `constant` applies one vertical root offset so the lowest foot joint over
   * the clip matches the target's rest foot height. Needs target rest joints.
   */
  grounding?: "none" | "constant";
  /** Rotation of root orientation and root travel about the vertical axis. */
  yawOffsetDegrees?: number;
};

/** A humanoid bone's world rest transform, serializable across Workers. */
export type HumanoidRestJoint = {
  position: [number, number, number];
  rotation: [number, number, number, number];
};

export type HumanoidRestJoints = Partial<Record<HumanoidBoneName, HumanoidRestJoint>>;

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
