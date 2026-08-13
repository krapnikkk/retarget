import {
  DEFAULT_PROCESSING_BUDGET,
  ProcessingBudgetError,
} from "./processing-budget";
import type {
  RetargetJobProgress,
  RetargetJobRequest,
  RetargetJobResponse,
  RetargetJobTask,
} from "./types";

export type RunRetargetJobOptions = {
  signal?: AbortSignal;
  deadlineMs?: number;
  onProgress?: (progress: RetargetJobProgress) => void;
};

export async function runRetargetJob<TResult = unknown>(
  task: RetargetJobTask,
  {
    deadlineMs = DEFAULT_PROCESSING_BUDGET.softDeadlineMs,
    onProgress,
    signal,
  }: RunRetargetJobOptions = {},
): Promise<TResult> {
  const request: RetargetJobRequest = {
    jobId: crypto.randomUUID(),
    deadlineMs,
    task,
  };
  if (signal?.aborted) throw createAbortError();

  if (typeof Worker === "undefined") {
    const { executeRetargetJob } = await import("./execute-retarget-job");
    const result = await executeRetargetJob(request, (phase, progress) =>
      onProgress?.({
        jobId: request.jobId,
        type: "progress",
        phase,
        progress,
      }),
    );
    if (signal?.aborted) throw createAbortError();
    return result as TResult;
  }

  return new Promise<TResult>((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/retarget.worker.js", import.meta.url),
      { name: `retarget-${request.jobId}`, type: "module" },
    );
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(
        new ProcessingBudgetError({
          code: "PROCESSING_DEADLINE_EXCEEDED",
          limit: deadlineMs,
          message: "retarget worker exceeded its deadline",
          phase: "worker",
        }),
      );
    }, deadlineMs);
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(event.message || "Retarget worker failed."));
    });
    worker.addEventListener("message", (event: MessageEvent<RetargetJobResponse>) => {
      const response = event.data;
      if (!response || response.jobId !== request.jobId) return;
      if (response.type === "progress") {
        onProgress?.(response);
        return;
      }
      cleanup();
      if (response.type === "failure") {
        const error = new Error(response.error.message);
        error.name = response.error.name;
        Object.assign(error, {
          code: response.error.code,
          details: response.error.details,
        });
        reject(error);
        return;
      }
      resolve(response.result as TResult);
    });
    worker.postMessage(request, collectTaskTransfers(task));
  });
}

function collectTaskTransfers(task: RetargetJobTask): Transferable[] {
  if (
    task.type === "import-motion" ||
    task.type === "convert-mmd-avatar" ||
    task.type === "inspect-rigged-gltf" ||
    task.type === "validate-motion-export" ||
    task.type === "validate-avatar-export"
  ) {
    if (task.type === "inspect-rigged-gltf") {
      return [task.bytes, ...collectResourceTransfers(task.resources)];
    }
    if (task.type === "convert-mmd-avatar") {
      return [
        task.bytes,
        ...collectResourceTransfers(task.assetPackage?.resources),
      ];
    }
    return [task.bytes];
  }
  if (task.type === "retarget-rigged-gltf") {
    return [
      task.motionBytes,
      ...(task.targetBytes ? [task.targetBytes] : []),
      ...collectResourceTransfers(task.motionResources),
      ...collectResourceTransfers(task.targetResources),
    ];
  }
  return [];
}

function collectResourceTransfers(
  resources?: Readonly<Record<string, ArrayBuffer>>,
) {
  return resources ? Object.values(resources) : [];
}

function createAbortError() {
  return new DOMException("Retarget job was cancelled.", "AbortError");
}
