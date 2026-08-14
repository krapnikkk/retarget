/// <reference lib="webworker" />

import { executeRetargetJob } from "@/jobs/execute-retarget-job";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";
import type {
  RetargetJobFailure,
  RetargetJobResponse,
} from "@/jobs/types";
import { isRetargetError } from "@/retarget";
import { executeBrowserInputPreparation } from "@/browser/input-preparation-worker";
import { collectArrayBufferTransfers } from "@/jobs/transferables";
import {
  assertRetargetJobRequest,
  assertRetargetJobResponse,
} from "@/jobs/runtime-protocol";
import {
  isBrowserInputPreparationRequest,
  type BrowserInputPreparationResponse,
} from "@/browser/input-preparation-protocol";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener(
  "message",
  async (
    event: MessageEvent<unknown>,
  ) => {
    const request = event.data;
    const jobId = request && typeof request === "object" &&
        "jobId" in request && typeof request.jobId === "string"
      ? request.jobId
      : "invalid-request";
    try {
      if (isBrowserInputPreparationRequest(request)) {
        const result = await executeBrowserInputPreparation(
          request,
          (phase, progress) => {
            post({
              jobId: request.jobId,
              type: "progress",
              phase,
              progress,
            });
          },
        );
        post(
          { jobId: request.jobId, type: "success", result },
          collectArrayBufferTransfers(result),
        );
        return;
      }
      assertRetargetJobRequest(request);
      const result = await executeRetargetJob(request, (phase, progress) => {
        post({
          schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
          jobId: request.jobId,
          type: "progress",
          phase,
          progress,
        });
      });
      const response = {
        schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
        jobId: request.jobId,
        type: "success" as const,
        result,
      };
      assertRetargetJobResponse(response, request);
      post(
        response,
        collectArrayBufferTransfers(result),
      );
    } catch (cause) {
      post({
        schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
        jobId,
        type: "failure",
        error: serializeError(cause),
      });
    }
  },
);

function post(
  message: RetargetJobResponse | BrowserInputPreparationResponse,
  transfer: Transferable[] = [],
) {
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
    code: isRetargetError(cause) ? cause.code : "RETARGET_JOB_FAILED",
    message: cause.message,
    details,
  };
}
