import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { isRetargetError } from "@/retarget";
import { resolveNodeToolBudget } from "./budget";
import type {
  NodeToolError,
  NodeToolJobFailure,
  NodeToolJobResult,
  NodeToolTask,
  NodeToolTaskResult,
  NodeToolWorkerRequest,
  NodeToolWorkerResponse,
  RunNodeToolJobOptions,
} from "./types";

export async function runNodeToolJob<TTask extends NodeToolTask>(
  task: TTask,
  options: RunNodeToolJobOptions = {},
): Promise<NodeToolJobResult<TTask>> {
  const jobId = randomUUID();
  if (options.signal?.aborted) {
    return failure(jobId, cancellationError());
  }

  let budget;
  try {
    budget = resolveNodeToolBudget(options.budget);
  } catch (cause) {
    return failure(jobId, serializeLocalError(cause));
  }

  const request: NodeToolWorkerRequest = { jobId, budget, task };
  return new Promise<NodeToolJobResult<TTask>>((resolve) => {
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("./workers/node-tooling.worker.js", import.meta.url),
        { name: `3dretarget-node-tool-${jobId}` },
      );
    } catch (cause) {
      resolve(failure(jobId, workerUnavailableError(cause)));
      return;
    }

    const finish = (result: NodeToolJobResult<TTask>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      void worker.terminate();
      resolve(result);
    };
    const abort = () => finish(failure(jobId, cancellationError()));
    const timeout = setTimeout(() => {
      finish(
        failure(jobId, {
          name: "ProcessingBudgetError",
          code: "PROCESSING_DEADLINE_EXCEEDED",
          message: "Node tooling worker exceeded its processing deadline.",
          details: { limit: budget.softDeadlineMs, phase: "worker" },
        }),
      );
    }, budget.softDeadlineMs);

    options.signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (response: NodeToolWorkerResponse) => {
      if (!response || response.jobId !== jobId) return;
      if (response.type === "progress") {
        try {
          options.onProgress?.(response);
        } catch (cause) {
          finish(failure(jobId, serializeLocalError(cause)));
        }
        return;
      }
      if (response.type === "failure") {
        finish(failure(jobId, response.error));
        return;
      }
      finish({
        ok: true,
        jobId,
        result: response.result as NodeToolTaskResult<TTask>,
        diagnostics: response.diagnostics,
      });
    });
    worker.on("error", (cause) => {
      finish(failure(jobId, workerUnavailableError(cause)));
    });
    worker.on("exit", (code) => {
      if (!settled) {
        finish(
          failure(jobId, {
            name: "Error",
            code: "RETARGET_JOB_FAILED",
            message: `Node tooling worker exited before returning a result (code ${code}).`,
            details: { exitCode: code },
          }),
        );
      }
    });
    try {
      worker.postMessage(request);
    } catch (cause) {
      finish(failure(jobId, serializeLocalError(cause)));
    }
  });
}

function failure(jobId: string, error: NodeToolError): NodeToolJobFailure {
  return { ok: false, jobId, error };
}

function cancellationError(): NodeToolError {
  return {
    name: "AbortError",
    code: "OPERATION_CANCELLED",
    message: "Node tooling operation was cancelled.",
  };
}

function workerUnavailableError(cause: unknown): NodeToolError {
  return {
    name: cause instanceof Error ? cause.name : "Error",
    code: "WORKER_UNAVAILABLE",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

function serializeLocalError(cause: unknown): NodeToolError {
  if (isRetargetError(cause)) {
    return {
      name: cause.name,
      code: cause.code,
      message: cause.message,
      details: cause.details,
    };
  }
  return {
    name: cause instanceof Error ? cause.name : "Error",
    code: "RETARGET_JOB_FAILED",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}
