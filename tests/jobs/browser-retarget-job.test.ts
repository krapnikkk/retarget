import { afterEach, describe, expect, it, vi } from "vitest";
import { runRetargetJob } from "@/jobs/browser-retarget-job";

class PendingWorker extends EventTarget {
  static instances: PendingWorker[] = [];

  readonly transfers: Transferable[][] = [];
  terminated = false;

  constructor() {
    super();
    PendingWorker.instances.push(this);
  }

  postMessage(_message: unknown, transfers: Transferable[]) {
    this.transfers.push(transfers);
  }

  terminate() {
    this.terminated = true;
  }
}

describe("browser retarget worker boundary", () => {
  afterEach(() => {
    PendingWorker.instances = [];
    vi.unstubAllGlobals();
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

  it("transfers glTF sidecar buffers without copying them", async () => {
    vi.stubGlobal("window", globalThis);
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

    expect(worker.transfers[0]).toEqual([primary, sidecar]);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("transfers MMD package resources with the model conversion job", async () => {
    vi.stubGlobal("window", globalThis);
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
      { signal: controller.signal },
    );
    const worker = PendingWorker.instances[0]!;

    expect(worker.transfers[0]).toEqual([primary, texture]);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
