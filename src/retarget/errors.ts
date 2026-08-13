export const RETARGET_ERROR_CODES = [
  "VRM_PARSE_FAILED",
  "VRM_MISSING_HUMANOID_BONE",
  "FBX_PARSE_FAILED",
  "FBX_NOT_MIXAMO",
  "FBX_NO_ANIMATION",
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
] as const;

export type RetargetErrorCode = (typeof RETARGET_ERROR_CODES)[number];

export type RetargetError = {
  code: RetargetErrorCode;
  message: string;
  cause?: unknown;
};

export const RETARGET_ERROR_MESSAGES: Record<RetargetErrorCode, string> = {
  VRM_PARSE_FAILED: "The VRM file could not be parsed.",
  VRM_MISSING_HUMANOID_BONE: "The VRM is missing required humanoid bones.",
  FBX_PARSE_FAILED: "The FBX file could not be parsed.",
  FBX_NOT_MIXAMO: "The FBX skeleton does not look like a Mixamo humanoid.",
  FBX_NO_ANIMATION: "The FBX file does not contain an animation clip.",
  VRMA_PARSE_FAILED: "The VRMA file could not be parsed.",
  BVH_PARSE_FAILED: "The BVH file could not be parsed.",
  VMD_PARSE_FAILED: "The VMD file could not be parsed.",
  GLTF_ANIMATION_PARSE_FAILED: "The glTF animation file could not be parsed.",
  UNSUPPORTED_FORMAT: "This file type is not supported by the selected workflow.",
  WEBGL_UNAVAILABLE: "This browser cannot create the required WebGL context.",
  FILE_TOO_LARGE: "This file is too large for browser-local processing.",
  PACKAGE_INVALID: "The asset package could not be prepared.",
  RETARGET_FAILED: "The retargeting pipeline failed.",
  EXPORT_FAILED: "The export failed.",
};

export function createRetargetError(
  code: RetargetErrorCode,
  cause?: unknown,
): RetargetError {
  return {
    code,
    message: RETARGET_ERROR_MESSAGES[code],
    cause,
  };
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
