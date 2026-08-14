import {
  collectTransferableAssetPackage,
  releaseAssetPackage,
  restoreAssetPackageContext,
} from "@/import/asset-package";
import { createRetargetWorker } from "@/jobs/browser-retarget-job";
import { RetargetError } from "@/retarget/errors";
import { resolveBrowserInputPreparationBudget } from "./input-preparation-budget";
import type {
  BrowserInputPreparationRequest,
  BrowserInputPreparationResponse,
  BrowserInputPreparationSource,
} from "./input-preparation-protocol";
import type {
  BrowserAssetInput,
  PrepareBrowserAssetInputOptions,
  PreparedBrowserAssetInput,
} from "./input-preparation-types";

export async function prepareBrowserAssetInput(
  input: BrowserAssetInput,
  {
    role,
    budget: budgetOverrides,
    onProgress,
    signal,
  }: PrepareBrowserAssetInputOptions,
): Promise<PreparedBrowserAssetInput> {
  signal?.throwIfAborted();
  const budget = resolveBrowserInputPreparationBudget(role, budgetOverrides);
  const request: BrowserInputPreparationRequest = {
    jobId: crypto.randomUUID(),
    deadlineMs: budget.maxElapsedMs,
    task: {
      type: "prepare-browser-input",
      source: normalizeSource(input),
      role,
      budget,
    },
  };

  return new Promise<PreparedBrowserAssetInput>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createRetargetWorker(`input-${request.jobId}`);
    } catch (cause) {
      reject(cause);
      return;
    }
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new RetargetError("PROCESSING_DEADLINE_EXCEEDED", {
        details: { limit: budget.maxElapsedMs, phase: "input-worker" },
        message: "Browser input preparation exceeded its processing deadline.",
      }));
    }, budget.maxElapsedMs);
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
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
        message: event.message || "Browser input preparation Worker failed.",
      }));
    });
    worker.addEventListener(
      "message",
      (event: MessageEvent<BrowserInputPreparationResponse>) => {
        const response = event.data;
        if (!response || response.jobId !== request.jobId) return;
        if (response.type === "progress") {
          onProgress?.({
            phase: response.phase,
            progress: response.progress,
          });
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

        const { entries, file, report, selection } = response.result;
        if (report && entries) {
          restoreAssetPackageContext(file, report, entries);
        }
        resolve(createPreparedResult(file, report, selection));
      },
    );
    try {
      worker.postMessage(request);
    } catch (cause) {
      cleanup();
      reject(new RetargetError("PACKAGE_INVALID", {
        cause,
        message: "The browser input could not be cloned into the isolated Worker.",
      }));
    }
  });
}

function createPreparedResult(
  file: File,
  report: PreparedBrowserAssetInput["report"],
  selection: PreparedBrowserAssetInput["selection"],
): PreparedBrowserAssetInput {
  let disposed = false;
  return {
    file,
    report,
    selection,
    get disposed() {
      return disposed;
    },
    async collectTransferable(signal) {
      assertActive(disposed);
      return collectTransferableAssetPackage(file, signal);
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      releaseAssetPackage(file);
      return true;
    },
  };
}

function normalizeSource(input: BrowserAssetInput): BrowserInputPreparationSource {
  if (input instanceof File) {
    return { kind: "file", file: input };
  }
  if (input.kind === "file") {
    return { kind: "file-handle", handle: input };
  }
  if (input.kind === "directory") {
    return { kind: "directory-handle", handle: input };
  }
  throw new RetargetError("PROCESSING_OPTION_INVALID", {
    message: "Browser input must be a File or readable file-system handle.",
  });
}

function assertActive(disposed: boolean) {
  if (disposed) {
    throw new RetargetError("PACKAGE_INVALID", {
      message: "The prepared browser input has already been disposed.",
    });
  }
}

function createAbortError() {
  return new DOMException("Browser input preparation was cancelled.", "AbortError");
}
