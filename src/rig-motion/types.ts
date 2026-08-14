import type {
  RigDefinitionId,
  RigFamilyId,
  RigRoleId,
  RigTopologyConflict,
} from "@/rigs/types";

export const RIG_MOTION_SCHEMA_VERSION = 2 as const;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type RigRestTransform = {
  role: RigRoleId;
  nodeName: string;
  parentRole?: RigRoleId;
  translation: Vec3;
  rotation: Quat;
  worldTranslation: Vec3;
  worldRotation: Quat;
  primaryAxis?: Vec3;
};

export type RigMotionTrack = {
  role: RigRoleId;
  path: "rotation" | "translation";
  times: number[];
  values: number[];
};

export type RigMotionDiagnostics = {
  solver: {
    id: RigMotionSolverId;
  };
  source: RigInspectionSummary;
  target: RigInspectionSummary;
  mapping: {
    mappedRoles: number;
    requiredRoles: number;
    requiredChainCoverage: number;
    missingRequiredSourceRoles: RigRoleId[];
    missingRequiredTargetRoles: RigRoleId[];
    unmappedSourceNodes: string[];
    unmappedTargetNodes: string[];
    topologyConflicts: {
      source: RigTopologyConflict[];
      target: RigTopologyConflict[];
    };
    axisWarnings: {
      source: RigRoleId[];
      target: RigRoleId[];
    };
  };
  contacts: {
    roles: RigRoleId[];
    transferredRoles: RigRoleId[];
    drift: RigContactDrift[];
  };
  rootScale: number;
  loopBoundary: {
    maxRotationDeltaDegrees: number;
    rootTranslationDelta: number;
  };
  warnings: string[];
  restPose: {
    source: RigRestTransform[];
    target: RigRestTransform[];
  };
};

export type RigMotionSolverId =
  | "same-rest-node-skin-signature"
  | "definition-mapped-swing-twist-v1"
  | "serpentine-chain-resample-v1";

export type RigContactDrift = {
  role: RigRoleId;
  space: "world";
  sampledFrames: number;
  groundedFrames: number;
  maxGroundedDrift: number;
};

export type RigInspectionSummary = {
  family: RigFamilyId;
  rigDefinitionId: RigDefinitionId;
  profileId: string;
  signature: string;
  mappedRoles: number;
  requiredRoles: number;
};

export type RigMotionV2 = {
  schemaVersion: typeof RIG_MOTION_SCHEMA_VERSION;
  rigDefinitionId: RigDefinitionId;
  family: RigFamilyId;
  name: string;
  duration: number;
  fps: number;
  source: {
    kind: "gltf-animation";
    filename: string;
    profileId: string;
    rigSignature: string;
    animation: {
      index: number;
      name: string;
      interpolationModes: ("LINEAR" | "STEP" | "CUBICSPLINE")[];
      resampledTracks: number;
    };
    topologyConflicts?: RigTopologyConflict[];
    axisWarnings?: RigRoleId[];
  };
  restPose: RigRestTransform[];
  tracks: RigMotionTrack[];
  createdAt: string;
  target?: {
    kind: "gltf-rigged";
    filename: string;
    profileId: string;
    rigSignature: string;
  };
  diagnostics?: RigMotionDiagnostics;
};

export type RetargetedRigMotionV2 = RigMotionV2 & {
  target: NonNullable<RigMotionV2["target"]>;
  diagnostics: RigMotionDiagnostics;
};
