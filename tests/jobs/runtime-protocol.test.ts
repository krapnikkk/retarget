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

  it("rejects unknown fields and non-plain request prototypes", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "unknown-field",
      extra: true,
      task: {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));

    const request = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(request, {
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "bad-prototype",
      task: {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
    });
    expect(() => assertRetargetJobRequest(request)).toThrow(
      expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }),
    );
  });

  it("validates optional buffers and asset-package dictionaries", () => {
    const resources = Object.create(null) as Record<string, ArrayBuffer>;
    Object.defineProperty(resources, "__proto__", {
      enumerable: true,
      value: new ArrayBuffer(4),
    });
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "bad-structural-json",
      task: {
        type: "inspect-humanoid-avatar",
        formatId: "gltf-humanoid",
        filename: "avatar.glb",
        bytes: new ArrayBuffer(0),
        structuralJSONBytes: new Uint8Array(8),
      },
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));

    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "valid-null-dictionary",
      task: {
        type: "convert-mmd-avatar",
        filename: "avatar.pmx",
        bytes: new ArrayBuffer(8),
        assetPackage: {
          primaryPath: "avatar.pmx",
          resources,
        },
      },
    })).not.toThrow();
  });

  it("validates FBX and glTF action selection at the Worker boundary", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "bad-action-selection",
      task: {
        type: "import-motion",
        formatId: "bvh",
        filename: "motion.bvh",
        bytes: new ArrayBuffer(8),
        animationIndex: 1,
      },
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "valid-action-selection",
      task: {
        type: "import-motion",
        formatId: "generic-fbx",
        filename: "motion.fbx",
        bytes: new ArrayBuffer(8),
        animationName: "Walk",
      },
    })).not.toThrow();
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "valid-gltf-action-selection",
      task: {
        type: "import-motion",
        formatId: "gltf-animation",
        filename: "motion.glb",
        bytes: new ArrayBuffer(8),
        animationIndex: 0,
      },
    })).not.toThrow();
  });

  it("rejects requests from another protocol version", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: 99,
      jobId: "future-client",
      task: { type: "inspect-rigged-gltf" },
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
  });

  it("accepts only serializable positive caller budgets", () => {
    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "valid-budget",
      budget: {
        parse: { maxInputBytes: 32 },
        processing: { maxOutputBytes: 64 },
      },
      task: {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
    })).not.toThrow();

    expect(() => assertRetargetJobRequest({
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: "invalid-budget",
      budget: { processing: { maxOutputBytes: 0 } },
      task: {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
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
