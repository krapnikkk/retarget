import {
  DEFAULT_PROCESSING_BUDGET,
  ProcessingBudgetError,
} from "./processing-budget";
import type {
  RetargetJobProgress,
  RetargetJobRequest,
  RetargetJobResponse,
  RetargetJobResult,
  RetargetJobTask,
} from "./types";
import { RetargetError } from "@/retarget/errors";

export type RunRetargetJobOptions = {
  signal?: AbortSignal;
  deadlineMs?: number;
  onProgress?: (progress: RetargetJobProgress) => void;
};

export async function runRetargetJob<TTask extends RetargetJobTask>(
  task: TTask,
  {
    deadlineMs = DEFAULT_PROCESSING_BUDGET.softDeadlineMs,
    onProgress,
    signal,
  }: RunRetargetJobOptions = {},
): Promise<RetargetJobResult<TTask>> {
  const request: RetargetJobRequest = {
    jobId: crypto.randomUUID(),
    deadlineMs,
    task,
  };
  if (signal?.aborted) throw createAbortError();

  return new Promise<RetargetJobResult<TTask>>((resolve, reject) => {
    const worker = createRetargetWorker(request.jobId);
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
      reject(new RetargetError("RETARGET_JOB_FAILED", {
        message: event.message || "Retarget worker failed.",
      }));
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
        const error = new RetargetError(response.error.code, {
          details: response.error.details,
          message: response.error.message,
        });
        error.name = response.error.name;
        reject(error);
        return;
      }
      resolve(response.result as RetargetJobResult<TTask>);
    });
    worker.postMessage(request, collectTaskTransfers(task));
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
    deadlineMs = DEFAULT_PROCESSING_BUDGET.softDeadlineMs,
    onProgress,
    signal,
  }: RunRetargetJobOptions = {},
): Promise<RetargetJobResult<TTask>> {
  if (signal?.aborted) throw createAbortError();
  const request: RetargetJobRequest = {
    jobId: crypto.randomUUID(),
    deadlineMs,
    task,
  };
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
  return result as RetargetJobResult<TTask>;
}

function collectTaskTransfers(task: RetargetJobTask): Transferable[] {
  if (
    task.type === "import-motion" ||
    task.type === "inspect-humanoid-avatar" ||
    task.type === "convert-mmd-avatar" ||
    task.type === "inspect-rigged-gltf" ||
    task.type === "validate-motion-export" ||
    task.type === "validate-avatar-export"
  ) {
    if (task.type === "inspect-humanoid-avatar") {
      return [
        task.bytes,
        ...(task.structuralJSONBytes ? [task.structuralJSONBytes] : []),
        ...collectResourceTransfers(task.resources),
        ...collectResourceTransfers(task.assetPackage?.resources),
      ];
    }
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
