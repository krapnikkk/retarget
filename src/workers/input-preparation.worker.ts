/// <reference lib="webworker" />

import { executeBrowserInputPreparation } from "@/browser/input-preparation-worker";
import { assertBrowserInputPreparationRequest } from "@/browser/input-preparation-request-protocol";
import {
  assertBrowserInputPreparationResponse,
  BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
  type BrowserInputPreparationResponse,
} from "@/browser/input-preparation-protocol";
import { serializeWorkerError } from "./serialize-error";

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const requestValue = event.data;
  const jobId = requestValue && typeof requestValue === "object" &&
      "jobId" in requestValue && typeof requestValue.jobId === "string"
    ? requestValue.jobId
    : "invalid-request";
  try {
    assertBrowserInputPreparationRequest(requestValue);
    const request = requestValue;
    const result = await executeBrowserInputPreparation(
      request,
      (phase, progress) => {
        const response: BrowserInputPreparationResponse = {
          schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
          jobId: request.jobId,
          type: "progress",
          phase,
          progress,
        };
        assertBrowserInputPreparationResponse(response, request);
        post(response);
      },
    );
    const response: BrowserInputPreparationResponse = {
      schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
      jobId: request.jobId,
      type: "success",
      result,
    };
    assertBrowserInputPreparationResponse(response, request);
    post(response);
  } catch (cause) {
    post({
      schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
      jobId,
      type: "failure",
      error: serializeWorkerError(cause),
    });
  }
});

function post(
  message: BrowserInputPreparationResponse,
  transfer: Transferable[] = [],
) {
  workerScope.postMessage(message, transfer);
}
