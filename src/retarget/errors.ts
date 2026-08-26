export const RETARGET_ERROR_CODES = [
  "VRM_PARSE_FAILED",
  "VRM_MISSING_HUMANOID_BONE",
  "FBX_PARSE_FAILED",
  "FBX_NOT_MIXAMO",
  "FBX_NO_ANIMATION",
  "FBX_ANIMATION_SELECTION_REQUIRED",
  "FBX_ANIMATION_NOT_FOUND",
  "VRMA_PARSE_FAILED",
  "BVH_PARSE_FAILED",
  "VMD_PARSE_FAILED",
  "GLTF_ANIMATION_PARSE_FAILED",
  "UNSUPPORTED_FORMAT",
  "WEBGL_UNAVAILABLE",
  "FILE_TOO_LARGE",
  "PACKAGE_INVALID",
  "RETARGET_FAILED",
  "EXPORT_FAILED",
  "PARSE_INVALID_COUNT",
  "PARSE_BUDGET_EXCEEDED",
  "PARSE_INVALID_LENGTH",
  "PARSE_INVALID_NUMBER",
  "PARSE_TRUNCATED",
  "BVH_INVALID_CHANNEL_VALUE",
  "BVH_FRAME_SIZE_MISMATCH",
  "BVH_INVALID_FRAME_TIME",
  "BVH_MISSING_CHANNELS",
  "GLTF_INVALID_OUTPUT",
  "GLTF_INVALID_TIME",
  "GLTF_INPUT_TYPE_MISMATCH",
  "GLTF_INTERPOLATION_UNSUPPORTED",
  "GLTF_OUTPUT_COUNT_MISMATCH",
  "GLTF_OUTPUT_TYPE_MISMATCH",
  "VRMA_DUPLICATE_TRACK",
  "PROCESSING_BUDGET_EXCEEDED",
  "PROCESSING_CLIP_INVALID",
  "PROCESSING_DEADLINE_EXCEEDED",
  "PROCESSING_DURATION_LIMIT",
  "PROCESSING_FPS_LIMIT",
  "PROCESSING_OPTION_INVALID",
  "PROCESSING_RIG_MOTION_INVALID",
  "RETARGET_JOB_FAILED",
  "WORKER_UNAVAILABLE",
  "WORKER_PROTOCOL_INVALID",
  "TARGET_RIG_IDENTITY_MISSING",
  "TARGET_RIG_INVALID",
  "TARGET_RIG_MISMATCH",
  "ROOT_MOTION_SCALE_UNRESOLVED",
  "TARGET_MAPPING_EMPTY",
  "TARGET_MAPPING_INSUFFICIENT",
  "TARGET_REQUIRED_CHAIN_MISSING",
  "ARTIFACT_INVALID",
  "ARTIFACT_AUTHORING_FAILED",
  "BINDING_INPUT_UNSUPPORTED",
  "BINDING_LANDMARKS_REQUIRED",
  "BINDING_RIG_INVALID",
  "BINDING_EDIT_STALE",
  "BINDING_WEIGHTS_INVALID",
  "BINDING_CONSTRAINT_CONFLICT",
  "OPERATION_CANCELLED",
] as const;

export type RetargetErrorCode = (typeof RETARGET_ERROR_CODES)[number];

export type RetargetErrorDetails = Record<string, unknown>;

export const RETARGET_ERROR_MESSAGES: Record<RetargetErrorCode, string> = {
  VRM_PARSE_FAILED: "The VRM file could not be parsed.",
  VRM_MISSING_HUMANOID_BONE: "The VRM is missing required humanoid bones.",
  FBX_PARSE_FAILED: "The FBX file could not be parsed.",
  FBX_NOT_MIXAMO: "The FBX skeleton does not look like a Mixamo humanoid.",
  FBX_NO_ANIMATION: "The FBX file does not contain an animation clip.",
  FBX_ANIMATION_SELECTION_REQUIRED: "The FBX contains multiple animation clips; select one explicitly.",
  FBX_ANIMATION_NOT_FOUND: "The selected FBX animation clip was not found.",
  VRMA_PARSE_FAILED: "The VRMA file could not be parsed.",
  BVH_PARSE_FAILED: "The BVH file could not be parsed.",
  VMD_PARSE_FAILED: "The VMD file could not be parsed.",
  GLTF_ANIMATION_PARSE_FAILED: "The glTF animation file could not be parsed.",
  UNSUPPORTED_FORMAT: "This file type is not supported by the selected workflow.",
  WEBGL_UNAVAILABLE: "This browser cannot create the required WebGL context.",
  FILE_TOO_LARGE: "This file exceeds the configured input byte limit.",
  PACKAGE_INVALID: "The asset package could not be prepared.",
  RETARGET_FAILED: "The retargeting pipeline failed.",
  EXPORT_FAILED: "The export failed.",
  PARSE_INVALID_COUNT: "The file declares an invalid item count.",
  PARSE_BUDGET_EXCEEDED: "The file exceeds a parsing safety limit.",
  PARSE_INVALID_LENGTH: "The file declares an invalid section length.",
  PARSE_INVALID_NUMBER: "The file contains an invalid numeric value.",
  PARSE_TRUNCATED: "The file is truncated.",
  BVH_INVALID_CHANNEL_VALUE: "The BVH contains an invalid channel value.",
  BVH_FRAME_SIZE_MISMATCH: "The BVH frame size does not match its hierarchy.",
  BVH_INVALID_FRAME_TIME: "The BVH frame time is invalid.",
  BVH_MISSING_CHANNELS: "The BVH hierarchy does not declare usable channels.",
  GLTF_INVALID_OUTPUT: "The glTF animation contains invalid output samples.",
  GLTF_INVALID_TIME: "The glTF animation contains invalid key times.",
  GLTF_INPUT_TYPE_MISMATCH: "The glTF animation input accessor type is invalid.",
  GLTF_INTERPOLATION_UNSUPPORTED: "The glTF interpolation mode is unsupported.",
  GLTF_OUTPUT_COUNT_MISMATCH: "The glTF animation output count is invalid.",
  GLTF_OUTPUT_TYPE_MISMATCH: "The glTF animation output accessor type is invalid.",
  VRMA_DUPLICATE_TRACK: "The VRMA contains duplicate humanoid tracks.",
  PROCESSING_BUDGET_EXCEEDED: "The job exceeds a processing safety limit.",
  PROCESSING_CLIP_INVALID: "The humanoid motion clip is invalid.",
  PROCESSING_DEADLINE_EXCEEDED: "The job exceeded its processing deadline.",
  PROCESSING_DURATION_LIMIT: "The motion duration exceeds the processing limit.",
  PROCESSING_FPS_LIMIT: "The motion frame rate exceeds the processing limit.",
  PROCESSING_OPTION_INVALID: "A retargeting option is invalid.",
  PROCESSING_RIG_MOTION_INVALID: "The rig motion is invalid.",
  RETARGET_JOB_FAILED: "The retargeting job failed.",
  WORKER_UNAVAILABLE: "The isolated browser Worker is unavailable.",
  WORKER_PROTOCOL_INVALID: "The Worker request or response protocol is invalid.",
  TARGET_RIG_IDENTITY_MISSING: "The solved motion does not identify its target rig.",
  TARGET_RIG_INVALID: "The target rig contains invalid rest-pose evidence.",
  TARGET_RIG_MISMATCH: "The export target differs from the solved motion target.",
  ROOT_MOTION_SCALE_UNRESOLVED:
    "Root motion uses source units but has no reliable source scale evidence.",
  TARGET_MAPPING_EMPTY: "No source motion tracks map to the target rig.",
  TARGET_MAPPING_INSUFFICIENT: "Mapped motion tracks do not belong to the target rig.",
  TARGET_REQUIRED_CHAIN_MISSING: "The mapping does not cover a required target chain.",
  ARTIFACT_INVALID: "The authored or supplied artifact is invalid.",
  ARTIFACT_AUTHORING_FAILED: "The artifact could not be authored and validated.",
  BINDING_INPUT_UNSUPPORTED: "The model is outside the supported humanoid binding profile.",
  BINDING_LANDMARKS_REQUIRED: "The geometry does not provide sufficient fitting evidence; supply anatomical landmarks.",
  BINDING_RIG_INVALID: "The binding skeleton or joint edit is invalid.",
  BINDING_EDIT_STALE: "The binding edit belongs to a different asset, topology, or revision.",
  BINDING_WEIGHTS_INVALID: "The binding weights or weight edit are invalid.",
  BINDING_CONSTRAINT_CONFLICT: "The binding weight constraints cannot be satisfied.",
  OPERATION_CANCELLED: "The operation was cancelled.",
};

export class RetargetError extends Error {
  readonly code: RetargetErrorCode;
  readonly details?: RetargetErrorDetails;

  constructor(
    code: RetargetErrorCode,
    options: {
      cause?: unknown;
      details?: RetargetErrorDetails;
      message?: string;
    } = {},
  ) {
    super(
      options.message ?? RETARGET_ERROR_MESSAGES[code],
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "RetargetError";
    this.code = code;
    this.details = options.details;
  }
}

export function createRetargetError(
  code: RetargetErrorCode,
  cause?: unknown,
): RetargetError {
  return new RetargetError(code, { cause });
}

export function isRetargetError(value: unknown): value is RetargetError {
  if (!value || typeof value !== "object") {
    return false;
  }

  const code = (value as Partial<RetargetError>).code;
  return Boolean(
    code && (RETARGET_ERROR_CODES as readonly string[]).includes(code),
  );
}
