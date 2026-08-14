import { describe, expect, it } from "vitest";
import {
  assertRetargetJobRequest,
  assertRetargetJobResponse,
} from "@/jobs/runtime-protocol";
import {
  RETARGET_JOB_PROTOCOL_VERSION,
  type RetargetJobRequest,
} from "@/jobs/types";

describe("retarget Worker runtime protocol", () => {
  it("rejects unknown task discriminators", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "unknown-task",
      task: { type: "surprise" },
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
  });

  it("rejects unknown format IDs instead of falling through", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "unknown-format",
      task: {
        type: "import-motion",
        formatId: "not-gltf",
        filename: "motion.bin",
        bytes: new ArrayBuffer(8),
      },
    })).toThrow(expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }));
  });

  it("rejects malformed external-resource maps", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "bad-resources",
      task: {
        type: "import-motion",
        formatId: "gltf-animation",
        filename: "motion.gltf",
        bytes: new ArrayBuffer(8),
        resources: { "motion.bin": new Uint8Array(8) },
      },
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
  });

  it("rejects requests from another protocol version", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: 99,
      jobId: "future-client",
      task: { type: "inspect-rigged-gltf" },
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
  });

  it("validates success results against the requested task", () => {
    const request: RetargetJobRequest = {
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "bad-result",
      task: {
        type: "export-motion",
        formatId: "motion-json",
        clip: {} as never,
      },
    };

    expect(() => assertRetargetJobResponse({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: request.jobId,
      type: "success",
      result: { bytes: [1, 2, 3] },
    }, request)).toThrow(
      expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }),
    );
  });

  it("rejects malformed progress and unregistered failure responses", () => {
    const request: RetargetJobRequest = {
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "bad-response",
      task: {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
    };
    expect(() => assertRetargetJobResponse({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: request.jobId,
      type: "progress",
      phase: "parse",
      progress: 2,
    }, request)).toThrow(
      expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }),
    );
    expect(() => assertRetargetJobResponse({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: request.jobId,
      type: "failure",
      error: { name: "Error", code: "ARBITRARY", message: "bad" },
    }, request)).toThrow(
      expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }),
    );
  });
});
