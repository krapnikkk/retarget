import { ProcessingBudgetError } from "@/processing-budget";
import { RETARGET_JOB_PROTOCOL_VERSION } from "./types";
import type {
  RetargetJobProgress,
  RetargetJobRequest,
  RetargetJobResponse,
  RetargetJobResult,
  RetargetJobBudget,
  RetargetJobTask,
} from "./types";
import { RetargetError } from "@/retarget/errors";
import { collectRetargetTaskTransfers } from "./transferables";
import {
  assertRetargetJobRequest,
  assertRetargetJobRequestCooperatively,
  assertRetargetJobResponse,
  assertRetargetJobResponseCooperatively,
} from "./runtime-protocol";

export type BufferOwnership = "copy" | "transfer";

export type RunRetargetJobOptions = {
  signal?: AbortSignal;
  deadlineMs?: number;
  budget?: RetargetJobBudget;
  onProgress?: (progress: RetargetJobProgress) => void;
  bufferOwnership?: BufferOwnership;
};

export async function runRetargetJob<TTask extends RetargetJobTask>(
  task: TTask,
  {
    deadlineMs,
    budget,
    onProgress,
    signal,
    bufferOwnership = "copy",
  }: RunRetargetJobOptions = {},
): Promise<RetargetJobResult<TTask>> {
  if (signal?.aborted) throw createAbortError();
  const requestToValidate: RetargetJobRequest = {
    schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
    jobId: crypto.randomUUID(),
    deadlineMs,
    budget,
    task,
  };
  const yieldControl = async () => {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    if (signal?.aborted) throw createAbortError();
  };
  if (isHumanoidBindingDataTask(task)) {
    await assertRetargetJobRequestCooperatively(requestToValidate, yieldControl);
  } else {
    assertRetargetJobRequest(requestToValidate);
  }
  // In copy mode postMessage performs the one required structured clone. An
  // eager clone followed by postMessage cloned large JSON snapshots twice.
  const workerTask = task;
  const request: RetargetJobRequest = {
    ...requestToValidate,
    task: workerTask,
  };

  return new Promise<RetargetJobResult<TTask>>((resolve, reject) => {
    const worker = createRetargetWorker(request.jobId);
    let settled = false;
    let validatingResponse = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const cleanup = () => {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("messageerror", onMessageError);
      worker.terminate();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (result: RetargetJobResult<TTask>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const abort = () => fail(createAbortError());
    const onError = (event: ErrorEvent) => {
      fail(new RetargetError("RETARGET_JOB_FAILED", {
        message: event.message || "Retarget worker failed.",
      }));
    };
    const onMessageError = () => {
      fail(new RetargetError("RETARGET_JOB_FAILED", {
        message: "Retarget worker returned an unreadable message.",
      }));
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (validatingResponse) {
        fail(new RetargetError("WORKER_PROTOCOL_INVALID", {
          message: "Retarget worker sent overlapping responses.",
        }));
        return;
      }
      validatingResponse = true;
      void handleMessage(event).finally(() => { validatingResponse = false; });
    };
    const handleMessage = async (event: MessageEvent<unknown>) => {
      const response = event.data;
      try {
        if (isHumanoidBindingDataTask(request.task)) {
          await assertRetargetJobResponseCooperatively(response, request, yieldControl);
        } else {
          assertRetargetJobResponse(response, request);
        }
      } catch (cause) {
        fail(cause);
        return;
      }
      if (settled) return;
      const validatedResponse = response as RetargetJobResponse;
      if (validatedResponse.type === "progress") {
        try {
          onProgress?.(validatedResponse);
        } catch (cause) {
          fail(new RetargetError("RETARGET_JOB_FAILED", {
            cause,
            message: "Retarget progress callback failed.",
          }));
        }
        return;
      }
      if (validatedResponse.type === "failure") {
        const error = new RetargetError(validatedResponse.error.code, {
          details: validatedResponse.error.details,
          message: validatedResponse.error.message,
        });
        error.name = validatedResponse.error.name;
        fail(error);
        return;
      }
      succeed(validatedResponse.result as RetargetJobResult<TTask>);
    };
    if (deadlineMs !== undefined) {
      timeout = globalThis.setTimeout(() => {
        fail(
          new ProcessingBudgetError({
            code: "PROCESSING_DEADLINE_EXCEEDED",
            limit: deadlineMs,
            message: "retarget worker exceeded its deadline",
            phase: "worker",
          }),
        );
      }, deadlineMs);
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", onError);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("messageerror", onMessageError);
    try {
      worker.postMessage(
        request,
        bufferOwnership === "transfer"
          ? collectRetargetTaskTransfers(workerTask)
          : [],
      );
    } catch (cause) {
      fail(new RetargetError("RETARGET_JOB_FAILED", {
        cause,
        message: "Retarget worker request could not be cloned.",
      }));
    }
  });
}

export function createRetargetWorker(jobId: string) {
  if (typeof Worker === "undefined") {
    throw new RetargetError("WORKER_UNAVAILABLE");
  }
  return new Worker(
    new URL("../workers/retarget.worker.js", import.meta.url),
    { name: `retarget-${jobId}`, type: "module" },
  );
}

// Explicit non-isolated execution exists for local tooling and unit tests. It
// is deliberately not re-exported from the browser package entry.
export async function runRetargetJobInline<TTask extends RetargetJobTask>(
  task: TTask,
  {
    deadlineMs,
    budget,
    onProgress,
    signal,
  }: RunRetargetJobOptions = {},
): Promise<RetargetJobResult<TTask>> {
  if (signal?.aborted) throw createAbortError();
  const request: RetargetJobRequest = {
    schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
    jobId: crypto.randomUUID(),
    deadlineMs,
    budget,
    task,
  };
  const { executeRetargetJob } = await import("./execute-retarget-job");
  const result = await executeRetargetJob(request, (phase, progress) =>
    onProgress?.({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: request.jobId,
      type: "progress",
      phase,
      progress,
    }),
  );
  if (signal?.aborted) throw createAbortError();
  return result as RetargetJobResult<TTask>;
}

function createAbortError() {
  return new DOMException("Retarget job was cancelled.", "AbortError");
}

function isHumanoidBindingDataTask(value: unknown): value is Extract<RetargetJobTask, { type: "humanoid-binding" }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "type");
  return !!descriptor && "value" in descriptor && descriptor.enumerable === true && descriptor.value === "humanoid-binding";
}
