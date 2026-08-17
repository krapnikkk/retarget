import { afterEach, describe, expect, it, vi } from "vitest";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";

class PendingWorker extends EventTarget {
  static instances: PendingWorker[] = [];
  static postError: unknown;

  readonly transfers: Transferable[][] = [];
  readonly messages: unknown[] = [];
  terminated = false;

  constructor() {
    super();
    PendingWorker.instances.push(this);
  }

  postMessage(message: unknown, transfers: Transferable[]) {
    if (PendingWorker.postError) throw PendingWorker.postError;
    this.messages.push(message);
    this.transfers.push(transfers);
    structuredClone(message, {
      transfer: transfers,
    });
  }

  terminate() {
    this.terminated = true;
  }
}

describe("browser retarget worker boundary", () => {
  afterEach(() => {
    PendingWorker.instances = [];
    PendingWorker.postError = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails closed when an isolated Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);

    await expect(
      runRetargetJob({
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      }),
    ).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
  });

  it("terminates an active worker when the caller aborts", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("Worker", PendingWorker);
    const controller = new AbortController();
    const promise = runRetargetJob(
      {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(PendingWorker.instances).toHaveLength(1);
    expect(PendingWorker.instances[0]?.terminated).toBe(true);
  });

  it("does not assign a library-owned deadline by default", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    const controller = new AbortController();
    const promise = runRetargetJob(
      {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
      { signal: controller.signal },
    );

    expect(PendingWorker.instances[0]?.messages[0]).toMatchObject({
      deadlineMs: undefined,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("copies glTF buffers by default before transferring worker-owned clones", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    const controller = new AbortController();
    const primary = new ArrayBuffer(8);
    const sidecar = new ArrayBuffer(16);
    const promise = runRetargetJob(
      {
        type: "inspect-rigged-gltf",
        bytes: primary,
        filename: "rig.gltf",
        resources: { "rig.bin": sidecar },
      },
      { signal: controller.signal },
    );
    const worker = PendingWorker.instances[0]!;

    expect(worker.transfers[0]).toHaveLength(2);
    expect(worker.transfers[0]).not.toContain(primary);
    expect(worker.transfers[0]).not.toContain(sidecar);
    expect(primary.byteLength).toBe(8);
    expect(sidecar.byteLength).toBe(16);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("allows callers to explicitly transfer MMD package ownership", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    const controller = new AbortController();
    const primary = new ArrayBuffer(8);
    const texture = new ArrayBuffer(16);
    const promise = runRetargetJob(
      {
        type: "convert-mmd-avatar",
        bytes: primary,
        filename: "avatar.pmx",
        assetPackage: {
          primaryPath: "model/avatar.pmx",
          resources: { "model/textures/base.png": texture },
        },
      },
      { bufferOwnership: "transfer", signal: controller.signal },
    );
    const worker = PendingWorker.instances[0]!;

    expect(worker.transfers[0]).toEqual([primary, texture]);
    expect(primary.byteLength).toBe(0);
    expect(texture.byteLength).toBe(0);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("deduplicates aliased avatar inspection buffers", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    const controller = new AbortController();
    const primary = new ArrayBuffer(8);
    const structuralJSONBytes = new ArrayBuffer(10);
    const sidecar = primary;
    const texture = new ArrayBuffer(16);
    const promise = runRetargetJob(
      {
        type: "inspect-humanoid-avatar",
        bytes: primary,
        filename: "avatar.gltf",
        formatId: "gltf-humanoid",
        structuralJSONBytes,
        resources: { "avatar.bin": sidecar },
        assetPackage: {
          primaryPath: "avatar.gltf",
          resources: { "textures/base.png": texture },
        },
      },
      { signal: controller.signal },
    );

    expect(PendingWorker.instances[0]!.transfers[0]).toHaveLength(3);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cleans up when postMessage throws synchronously", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    PendingWorker.postError = new DOMException("cannot clone", "DataCloneError");

    await expect(runRetargetJob({
      type: "inspect-rigged-gltf",
      bytes: new ArrayBuffer(8),
      filename: "rig.glb",
    })).rejects.toMatchObject({
      code: "RETARGET_JOB_FAILED",
      message: "Retarget worker request could not be cloned.",
    });
    expect(PendingWorker.instances[0]?.terminated).toBe(true);
  });

  it("rejects messageerror and terminates the worker", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    const promise = runRetargetJob({
      type: "inspect-rigged-gltf",
      bytes: new ArrayBuffer(8),
      filename: "rig.glb",
    });
    const worker = PendingWorker.instances[0]!;

    worker.dispatchEvent(new MessageEvent("messageerror"));

    await expect(promise).rejects.toMatchObject({
      code: "RETARGET_JOB_FAILED",
      message: "Retarget worker returned an unreadable message.",
    });
    expect(worker.terminated).toBe(true);
  });

  it("settles successful responses and terminates the worker", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    const promise = runRetargetJob({
      type: "export-motion",
      formatId: "motion-json",
      clip: {} as never,
    });
    const worker = PendingWorker.instances[0]!;
    const request = worker.messages[0] as { jobId: string };
    const result = new Uint8Array([1, 2, 3]);

    worker.dispatchEvent(new MessageEvent("message", { data: {
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: request.jobId,
      type: "success",
      result,
    } }));

    await expect(promise).resolves.toEqual(result);
    expect(worker.terminated).toBe(true);
  });

  it("contains progress callback failures and rejects immediately", async () => {
    vi.stubGlobal("Worker", PendingWorker);
    const promise = runRetargetJob(
      {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
      { onProgress: () => { throw new Error("observer failed"); } },
    );
    const worker = PendingWorker.instances[0]!;
    const request = worker.messages[0] as { jobId: string };

    worker.dispatchEvent(new MessageEvent("message", { data: {
      schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
      jobId: request.jobId,
      type: "progress",
      phase: "parse",
      progress: 0.5,
    } }));

    await expect(promise).rejects.toMatchObject({
      code: "RETARGET_JOB_FAILED",
      message: "Retarget progress callback failed.",
    });
    expect(worker.terminated).toBe(true);
  });

  it("terminates and rejects when the worker deadline expires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", PendingWorker);
    const promise = runRetargetJob(
      {
        type: "inspect-rigged-gltf",
        bytes: new ArrayBuffer(8),
        filename: "rig.glb",
      },
      { deadlineMs: 50 },
    );
    const rejection = expect(promise).rejects.toMatchObject({
      code: "PROCESSING_DEADLINE_EXCEEDED",
    });

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(PendingWorker.instances[0]?.terminated).toBe(true);
  });
});
