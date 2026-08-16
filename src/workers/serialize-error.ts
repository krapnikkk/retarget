import type { RetargetJobFailure } from "@/jobs/types";
import { isRetargetError } from "@/retarget/errors";

export function serializeWorkerError(cause: unknown): RetargetJobFailure["error"] {
  if (!(cause instanceof Error)) {
    return {
      name: "Error",
      code: "RETARGET_JOB_FAILED",
      message: String(cause),
    };
  }
  const explicitDetails = "details" in cause ? cause.details : undefined;
  const errorFields = cause as Error & Record<string, unknown>;
  const processingDetails = Object.fromEntries(
    (["declared", "limit", "phase"] as const).flatMap((key) => {
      const value = errorFields[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  const details =
    explicitDetails && typeof explicitDetails === "object"
      ? (explicitDetails as Record<string, unknown>)
      : Object.keys(processingDetails).length > 0
        ? processingDetails
        : undefined;
  return {
    name: cause.name,
    code: isRetargetError(cause) ? cause.code : "RETARGET_JOB_FAILED",
    message: cause.message,
    details,
  };
}
