/// <reference lib="webworker" />

import { executeRetargetJob } from "@/jobs/execute-retarget-job";
import type {
  RetargetJobFailure,
  RetargetJobRequest,
  RetargetJobResponse,
} from "@/jobs/types";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener(
  "message",
  async (event: MessageEvent<RetargetJobRequest>) => {
    const request = event.data;
    try {
      const result = await executeRetargetJob(request, (phase, progress) => {
        post({
          jobId: request.jobId,
          type: "progress",
          phase,
          progress,
        });
      });
      post(
        { jobId: request.jobId, type: "success", result },
        result instanceof Uint8Array ? [result.buffer] : [],
      );
    } catch (cause) {
      post({
        jobId: request.jobId,
        type: "failure",
        error: serializeError(cause),
      });
    }
  },
);

function post(message: RetargetJobResponse, transfer: Transferable[] = []) {
  workerScope.postMessage(message, transfer);
}

function serializeError(cause: unknown): RetargetJobFailure["error"] {
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
    code:
      "code" in cause && typeof cause.code === "string"
        ? cause.code
        : "RETARGET_JOB_FAILED",
    message: cause.message,
    details,
  };
}
