import type { HumanoidBoneName } from "@/retarget/types";

export type BindingVector3 = [number, number, number];
export type BindingQuaternion = [number, number, number, number];

/** World coordinates in the input glTF scene: metres, right handed, +Y up. */
export type BindingJoint = {
  bone: HumanoidBoneName;
  parent: HumanoidBoneName | null;
  position: BindingVector3;
  rotation: BindingQuaternion;
};

export type BindingPrimitiveIdentity = {
  /** Instance identity includes the node, not just the shared mesh index. */
  id: string;
  node: number;
  mesh: number;
  primitive: number;
  vertexCount: number;
  triangleCount: number;
};

export type BindingAssetIdentity = {
  sha256: string;
  topologySha256: string;
  primitives: BindingPrimitiveIdentity[];
};

export type BindingDiagnostic = {
  code: "MANUAL_REVIEW_REQUIRED" | "DISCONNECTED_COMPONENTS" | "EXISTING_RIG";
  message: string;
};

export type HumanoidBindingInspection = {
  schemaVersion: 1;
  asset: BindingAssetIdentity;
  bounds: { min: BindingVector3; max: BindingVector3 };
  diagnostics: BindingDiagnostic[];
};

export type BindingInfluence = { bone: HumanoidBoneName; weight: number };

export type BindingWeightEdit = {
  primitive: string;
  vertex: number;
  /** Replaces the complete unlocked row; omitted when only changing locks. */
  influences?: BindingInfluence[];
  /** Replaces locks for this row, including an empty array to unlock it. */
  locks?: BindingInfluence[];
};

export type BindingWeights = {
  primitive: string;
  /** Four entries per source vertex. Indices address snapshot.joints. */
  joints: number[];
  weights: number[];
};

/** JSON round-trippable editing state. The input asset bytes are stored separately. */
export type HumanoidBindingSnapshot = {
  schemaVersion: 1;
  profile: "humanoid-binding-v1";
  asset: BindingAssetIdentity;
  /** Content identity, not a timestamp; a no-op edit may retain this revision. */
  revision: string;
  rigRevision: string;
  joints: BindingJoint[];
  weights: BindingWeights[] | null;
  locks: BindingWeightEdit[];
  algorithm: "landmark-template-v1" | "existing-rig-v1";
  skinning: { algorithm: "surface-heat-v1"; iterations: number } | null;
  diagnostics: BindingDiagnostic[];
};

export type BindingEditBase = {
  snapshot: HumanoidBindingSnapshot;
  /** Optimistic concurrency token from the state the user actually edited. */
  expectedRevision: string;
};

export type HumanoidBindingCommand =
  | { operation: "inspect" }
  | {
      operation: "fit";
      pose: "t-pose" | "a-pose";
      /** +Z or -Z is explicit; orientation is never inferred from a filename. */
      forward: "+z" | "-z";
      /** Anatomical joint centres in scene world coordinates. */
      landmarks?: Partial<Record<HumanoidBoneName, BindingVector3>>;
    }
  | { operation: "use-rig"; joints: BindingJoint[] }
  | ({ operation: "edit-rig"; edits: Array<{
      bone: HumanoidBoneName;
      position?: BindingVector3;
      rotation?: BindingQuaternion;
    }> } & BindingEditBase)
  | ({ operation: "skin"; iterations?: number } & BindingEditBase)
  | ({ operation: "edit-weights"; edits: BindingWeightEdit[] } & BindingEditBase)
  | ({ operation: "export" } & BindingEditBase)
  | ({ operation: "validate"; outputBytes: ArrayBuffer } & BindingEditBase);

export type HumanoidBindingTask = {
  type: "humanoid-binding";
  bytes: ArrayBuffer;
  command: HumanoidBindingCommand;
};

export type HumanoidBindingValidation = {
  ok: boolean;
  assurance: "experimental";
  structural: { ok: boolean; issues: string[] };
  semantic: {
    ok: boolean;
    issues: string[];
    verticesCompared: number;
    posesCompared: number;
    maxRestPositionError: number;
    maxDeformedPositionError: number;
    tolerance: number;
  };
  ecosystem: { status: "not-run" };
};

export type HumanoidBindingExport = {
  bytes: Uint8Array;
  snapshotRevision: string;
  rigRevision: string;
  validation: HumanoidBindingValidation;
};

export type HumanoidBindingResult<T extends HumanoidBindingCommand> =
  T extends { operation: "inspect" } ? HumanoidBindingInspection
    : T extends { operation: "export" } ? HumanoidBindingExport
      : T extends { operation: "validate" } ? HumanoidBindingValidation
        : HumanoidBindingSnapshot;
