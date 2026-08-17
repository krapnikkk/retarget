import {
  collectTransferableAssetPackage,
  releaseAssetPackage,
  restoreAssetPackageContext,
} from "@/import/asset-package";
import { RetargetError } from "@/retarget/errors";
import { resolveBrowserInputPreparationBudget } from "./input-preparation-budget";
import {
  assertBrowserInputPreparationResponse,
  BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
} from "./input-preparation-protocol";
import type {
  BrowserInputPreparationRequest,
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
  const budget = resolveBrowserInputPreparationBudget(budgetOverrides);
  const request: BrowserInputPreparationRequest = {
    schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
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
      worker = createInputPreparationWorker(request.jobId);
    } catch (cause) {
      reject(cause);
      return;
    }
    let settled = false;
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
    const succeed = (result: PreparedBrowserAssetInput) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const abort = () => fail(createAbortError());
    const onError = (event: ErrorEvent) => {
      fail(new RetargetError("RETARGET_JOB_FAILED", {
        message: event.message || "Browser input preparation Worker failed.",
      }));
    };
    const onMessageError = () => {
      fail(new RetargetError("WORKER_PROTOCOL_INVALID", {
        message: "Browser input preparation Worker returned an unreadable message.",
      }));
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      const response = event.data;
      try {
        assertBrowserInputPreparationResponse(response, request);
      } catch (cause) {
        fail(cause);
        return;
      }
      if (response.type === "progress") {
        try {
          onProgress?.({
            phase: response.phase,
            progress: response.progress,
          });
        } catch (cause) {
          fail(new RetargetError("RETARGET_JOB_FAILED", {
            cause,
            message: "Browser input preparation progress callback failed.",
          }));
        }
        return;
      }
      if (response.type === "failure") {
        const error = new RetargetError(response.error.code, {
          details: response.error.details,
          message: response.error.message,
        });
        error.name = response.error.name;
        fail(error);
        return;
      }

      const { entries, file, report, selection } = response.result;
      if (report && entries) {
        restoreAssetPackageContext(file, report, entries);
      }
      succeed(createPreparedResult(file, report, selection));
    };
    if (budget.maxElapsedMs !== undefined) {
      timeout = globalThis.setTimeout(() => {
        fail(new RetargetError("PROCESSING_DEADLINE_EXCEEDED", {
          details: { limit: budget.maxElapsedMs, phase: "input-worker" },
          message: "Browser input preparation exceeded its processing deadline.",
        }));
      }, budget.maxElapsedMs);
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", onError);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("messageerror", onMessageError);
    try {
      worker.postMessage(request);
    } catch (cause) {
      fail(new RetargetError("PACKAGE_INVALID", {
        cause,
        message: "The browser input could not be cloned into the isolated Worker.",
      }));
    }
  });
}

function createInputPreparationWorker(jobId: string) {
  if (typeof Worker === "undefined") {
    throw new RetargetError("WORKER_UNAVAILABLE");
  }
  return new Worker(
    new URL("../workers/input-preparation.worker.js", import.meta.url),
    { name: `input-${jobId}`, type: "module" },
  );
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
