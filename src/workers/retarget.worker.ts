/// <reference lib="webworker" />

import { executeRetargetJob } from "@/jobs/execute-retarget-job";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";
import type { RetargetJobResponse } from "@/jobs/types";
import { collectRetargetResultTransfers } from "@/jobs/transferables";
import { packHumanoidBindingSnapshotResult } from "@/jobs/humanoid-binding-snapshot-transport";
import {
  assertRetargetJobRequest,
  assertRetargetJobResponse,
} from "@/jobs/runtime-protocol";
import { serializeWorkerError } from "./serialize-error";

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
      const transportedResult = packHumanoidBindingSnapshotResult(request.task, result);
      post(
        { ...response, result: transportedResult } as RetargetJobResponse,
        collectRetargetResultTransfers(request.task, transportedResult),
      );
    } catch (cause) {
      post({
        schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
        jobId,
        type: "failure",
        error: serializeWorkerError(cause),
      });
    }
  },
);

function post(
  message: RetargetJobResponse,
  transfer: Transferable[] = [],
) {
  workerScope.postMessage(message, transfer);
}
