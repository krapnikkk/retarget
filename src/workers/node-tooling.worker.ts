import { parentPort } from "node:worker_threads";
import { executeNodeToolTask } from "@/node-tooling/execute";
import type {
  NodeToolError,
  NodeToolWorkerRequest,
  NodeToolWorkerResponse,
} from "@/node-tooling/types";
import { isRetargetError } from "@/retarget";

if (!parentPort) {
  throw new Error("Node tooling worker requires a parent port.");
}

parentPort.on("message", async (request: NodeToolWorkerRequest) => {
  try {
    const execution = await executeNodeToolTask(
      request,
      (phase, progress) => post({
        jobId: request.jobId,
        type: "progress",
        phase,
        progress,
      }),
    );
    post(
      {
        jobId: request.jobId,
        type: "success",
        result: execution.result,
        diagnostics: execution.diagnostics,
      },
      collectResultTransfers(execution.result),
    );
  } catch (cause) {
    post({
      jobId: request.jobId,
      type: "failure",
      error: serializeWorkerError(cause),
    });
  }
});

function post(
  message: NodeToolWorkerResponse,
  transferList: readonly ArrayBuffer[] = [],
) {
  parentPort!.postMessage(message, transferList);
}

function collectResultTransfers(result: unknown): ArrayBuffer[] {
  if (result && typeof result === "object" && "bytes" in result && result.bytes instanceof Uint8Array &&
    result.bytes.buffer instanceof ArrayBuffer) return [result.bytes.buffer];
  if (!result || typeof result !== "object" || !("artifact" in result)) {
    return [];
  }
  const artifact = (result as { artifact?: { bytes?: unknown } }).artifact;
  return artifact?.bytes instanceof ArrayBuffer ? [artifact.bytes] : [];
}

function serializeWorkerError(cause: unknown): NodeToolError {
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
