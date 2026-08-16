import { afterEach, describe, expect, it, vi } from "vitest";
import { createZipArchive } from "@/export/zip";
import {
  prepareBrowserAssetInput,
} from "@/browser/input-preparation";
import {
  resolveBrowserInputPreparationBudget,
} from "@/browser/input-preparation-budget";
import { executeBrowserInputPreparation } from "@/browser/input-preparation-worker";
import { assertBrowserInputPreparationRequest } from "@/browser/input-preparation-request-protocol";
import {
  assertBrowserInputPreparationResponse,
  BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
} from "@/browser/input-preparation-protocol";
import type {
  BrowserInputPreparationRequest,
  BrowserInputPreparationResponse,
} from "@/browser/input-preparation-protocol";

const BVH = [
  "HIERARCHY",
  "ROOT Hips",
  "{",
  "  OFFSET 0 1 0",
  "  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation",
  "}",
  "MOTION",
  "Frames: 1",
  "Frame Time: 0.033333",
  "0 0 0 0 0 0",
].join("\n");

describe("browser input preparation worker", () => {
  it("selects renamed motion from bounded content evidence", async () => {
    const phases: string[] = [];
    const result = await executeBrowserInputPreparation(
      request(new File([BVH], "renamed.txt"), "motion"),
      (phase) => phases.push(phase),
    );

    expect(result.selection).toMatchObject({
      status: "matched",
      role: "motion",
      formatId: "bvh",
      container: "bvh",
    });
    expect(result.selection.bytesInspected).toBeLessThanOrEqual(
      resolveBrowserInputPreparationBudget("motion").maxProbeBytes,
    );
    expect(result.selection.evidence).toContainEqual({
      code: "container-signature",
      message: "BVH HIERARCHY and MOTION sections found",
    });
    expect(phases).toEqual([
      "discover",
      "read",
      "probe",
      "resolve",
      "complete",
    ]);
  });

  it("distinguishes inconclusive input from a positively unsupported role", async () => {
    const inconclusive = await executeBrowserInputPreparation(
      request(new File(["not motion data"], "garbage.bvh"), "motion"),
      () => undefined,
    );
    const unsupported = await executeBrowserInputPreparation(
      request(new File(["Pmd\0minimal"], "renamed.bin"), "motion"),
      () => undefined,
    );

    expect(inconclusive.selection).toMatchObject({
      status: "inconclusive",
      container: null,
      formatId: null,
    });
    expect(unsupported.selection).toMatchObject({
      status: "unsupported",
      container: "mmd-model",
      formatId: null,
    });
  });

  it("chooses a package primary by content rather than extension", async () => {
    const archive = createZipArchive([
      { name: "fake.bvh", bytes: new TextEncoder().encode("not motion") },
      { name: "nested/walk.txt", bytes: new TextEncoder().encode(BVH) },
      { name: "LICENSE.txt", bytes: new TextEncoder().encode("CC0") },
    ]);
    const result = await executeBrowserInputPreparation(
      request(
        new File([toArrayBuffer(archive)], "renamed.data"),
        "motion",
      ),
      () => undefined,
    );

    expect(result.file.name).toBe("walk.txt");
    expect(result.report).toMatchObject({
      sourceKind: "zip",
      primaryPath: "nested/walk.txt",
      entryCount: 3,
    });
    expect(result.selection).toMatchObject({
      status: "matched",
      formatId: "bvh",
    });
  });

  it("resolves sidecar evidence for a renamed glTF package primary", async () => {
    const gltf = JSON.stringify({
      asset: { version: "2.0" },
      nodes: [{ name: "Hips" }],
      skins: [{}],
      buffers: [{ uri: "missing.bin", byteLength: 4 }],
    });
    const archive = createZipArchive([
      { name: "avatar/model.data", bytes: new TextEncoder().encode(gltf) },
      { name: "LICENSE.txt", bytes: new TextEncoder().encode("CC0") },
    ]);
    const result = await executeBrowserInputPreparation(
      request(new File([toArrayBuffer(archive)], "avatar.bundle"), "avatar"),
      () => undefined,
    );

    expect(result.file.name).toBe("model.data");
    expect(result.selection).toMatchObject({
      status: "matched",
      container: "gltf",
    });
    expect(result.report?.missingResources).toEqual(["missing.bin"]);
  });

  it("owns bounded directory traversal after the host supplies a handle", async () => {
    const budget = resolveBrowserInputPreparationBudget("motion");
    const handle = directory("motion-project", [
      fileHandle("walk.data", BVH),
      fileHandle("LICENSE.txt", "CC0"),
    ]);
    const result = await executeBrowserInputPreparation(
      {
        schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
        jobId: "directory-input-test",
        deadlineMs: budget.maxElapsedMs,
        task: {
          type: "prepare-browser-input",
          source: { kind: "directory-handle", handle },
          role: "motion",
          budget,
        },
      },
      () => undefined,
    );

    expect(result.report).toMatchObject({
      sourceKind: "directory",
      primaryPath: "walk.data",
      resourceCount: 1,
    });
    expect(result.selection).toMatchObject({
      status: "matched",
      formatId: "bvh",
    });
  });

  it("checks compressed package bytes before archive expansion", async () => {
    const archive = createZipArchive([
      { name: "walk.bvh", bytes: new TextEncoder().encode(BVH) },
    ]);
    const input = new File([toArrayBuffer(archive)], "motion.zip");
    const preparedRequest = request(input, "motion");
    preparedRequest.task.budget.maxCompressedBytes = 8;

    await expect(
      executeBrowserInputPreparation(preparedRequest, () => undefined),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects invalid budget overrides instead of silently widening them", () => {
    expect(() =>
      resolveBrowserInputPreparationBudget("motion", { maxEntries: 0 }),
    ).toThrow(expect.objectContaining({ code: "PROCESSING_OPTION_INVALID" }));
    expect(
      resolveBrowserInputPreparationBudget("motion", {
        maxCompressedBytes: Number.MAX_SAFE_INTEGER,
      }).maxCompressedBytes,
    ).toBe(resolveBrowserInputPreparationBudget("motion").maxCompressedBytes);
  });
});

describe("public browser input preparation client", () => {
  afterEach(() => {
    PendingPreparationWorker.instances = [];
    SuccessfulPreparationWorker.urls = [];
    vi.unstubAllGlobals();
  });

  it("fails closed when the package-owned Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);

    await expect(
      prepareBrowserAssetInput(new File([BVH], "walk.bvh"), {
        role: "motion",
      }),
    ).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
  });

  it("terminates the isolated preparation Worker when aborted", async () => {
    vi.stubGlobal("Worker", PendingPreparationWorker);
    const controller = new AbortController();
    const promise = prepareBrowserAssetInput(
      new File([BVH], "walk.bvh"),
      { role: "motion", signal: controller.signal },
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(PendingPreparationWorker.instances).toHaveLength(1);
    expect(PendingPreparationWorker.instances[0]?.terminated).toBe(true);
  });

  it("restores package resources and provides an idempotent disposal lifecycle", async () => {
    vi.stubGlobal("Worker", SuccessfulPreparationWorker);
    const progress: string[] = [];
    const prepared = await prepareBrowserAssetInput(
      new File([BVH], "source.bvh"),
      {
        role: "motion",
        onProgress: ({ phase }) => progress.push(phase),
      },
    );

    expect(SuccessfulPreparationWorker.urls).toHaveLength(1);
    expect(String(SuccessfulPreparationWorker.urls[0])).toMatch(
      /\/workers\/input-preparation\.worker\.js$/,
    );
    expect(String(SuccessfulPreparationWorker.urls[0])).not.toContain(
      "retarget.worker",
    );
    const transferable = await prepared.collectTransferable();
    expect(progress).toEqual(["discover", "complete"]);
    expect(transferable?.primaryPath).toBe("motion/walk.bvh");
    expect(new Uint8Array(transferable!.resources["LICENSE.txt"]!)).toEqual(
      new TextEncoder().encode("CC0"),
    );
    expect(prepared.dispose()).toBe(true);
    expect(prepared.disposed).toBe(true);
    expect(prepared.dispose()).toBe(false);
    await expect(prepared.collectTransferable()).rejects.toMatchObject({
      code: "PACKAGE_INVALID",
    });
  });

  it("fails closed on malformed Worker responses", async () => {
    vi.stubGlobal("Worker", InvalidPreparationWorker);

    await expect(
      prepareBrowserAssetInput(new File([BVH], "walk.bvh"), {
        role: "motion",
      }),
    ).rejects.toMatchObject({ code: "WORKER_PROTOCOL_INVALID" });
  });

  it("terminates the Worker when a progress callback fails", async () => {
    vi.stubGlobal("Worker", SuccessfulPreparationWorker);

    await expect(
      prepareBrowserAssetInput(new File([BVH], "walk.bvh"), {
        role: "motion",
        onProgress() {
          throw new Error("consumer callback failed");
        },
      }),
    ).rejects.toMatchObject({ code: "RETARGET_JOB_FAILED" });
  });
});

describe("browser input preparation runtime protocol", () => {
  it("validates bounded requests and matching responses", () => {
    const preparedRequest = request(new File([BVH], "walk.bvh"), "motion");
    expect(() => assertBrowserInputPreparationRequest(preparedRequest)).not.toThrow();
    expect(() => assertBrowserInputPreparationResponse({
      schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
      jobId: preparedRequest.jobId,
      type: "progress",
      phase: "probe",
      progress: 0.5,
    }, preparedRequest)).not.toThrow();
  });

  it("rejects unsupported versions, inconsistent budgets, and malformed responses", () => {
    const preparedRequest = request(new File([BVH], "walk.bvh"), "motion");
    expect(() => assertBrowserInputPreparationRequest({
      ...preparedRequest,
      schemaVersion: 99,
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
    expect(() => assertBrowserInputPreparationRequest({
      ...preparedRequest,
      deadlineMs: preparedRequest.deadlineMs + 1,
    })).toThrow(expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }));
    expect(() => assertBrowserInputPreparationResponse({
      schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
      jobId: "another-job",
      type: "progress",
      phase: "probe",
      progress: 2,
    }, preparedRequest)).toThrow(
      expect.objectContaining({ code: "WORKER_PROTOCOL_INVALID" }),
    );
  });
});

class SuccessfulPreparationWorker extends EventTarget {
  static urls: Array<string | URL> = [];

  constructor(url: string | URL) {
    super();
    SuccessfulPreparationWorker.urls.push(url);
  }

  postMessage(message: BrowserInputPreparationRequest) {
    const primary = new File([BVH], "walk.bvh");
    const license = new Blob(["CC0"]);
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent<BrowserInputPreparationResponse>(
        "message",
        {
          data: {
            schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
            jobId: message.jobId,
            type: "progress",
            phase: "discover",
            progress: 0.1,
          },
        },
      ));
      this.dispatchEvent(new MessageEvent<BrowserInputPreparationResponse>(
        "message",
        {
          data: {
            schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
            jobId: message.jobId,
            type: "progress",
            phase: "complete",
            progress: 1,
          },
        },
      ));
      this.dispatchEvent(new MessageEvent<BrowserInputPreparationResponse>(
        "message",
        {
          data: {
            schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
            jobId: message.jobId,
            type: "success",
            result: {
              file: primary,
              report: {
                sourceKind: "zip",
                sourceName: "motion.zip",
                primaryPath: "motion/walk.bvh",
                entryCount: 2,
                resourceCount: 1,
                expandedBytes: primary.size + license.size,
                missingResources: [],
              },
              entries: [
                {
                  name: "motion/walk.bvh",
                  blob: primary,
                  byteLength: primary.size,
                },
                {
                  name: "LICENSE.txt",
                  blob: license,
                  byteLength: license.size,
                },
              ],
              selection: {
                status: "matched",
                role: "motion",
                formatId: "bvh",
                profileId: "bvh-humanoid",
                container: "bvh",
                confidence: 0.6,
                evidence: [],
                warnings: [],
                bytesInspected: primary.size,
              },
            },
          },
        },
      ));
    });
  }

  terminate() {}
}

class PendingPreparationWorker extends EventTarget {
  static instances: PendingPreparationWorker[] = [];
  terminated = false;

  constructor() {
    super();
    PendingPreparationWorker.instances.push(this);
  }

  postMessage() {}

  terminate() {
    this.terminated = true;
  }
}

class InvalidPreparationWorker extends EventTarget {
  postMessage(message: BrowserInputPreparationRequest) {
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent("message", {
        data: {
          schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
          jobId: message.jobId,
          type: "progress",
          phase: "probe",
          progress: 2,
        },
      }));
    });
  }

  terminate() {}
}

function request(file: File, role: "avatar" | "motion") {
  const budget = resolveBrowserInputPreparationBudget(role);
  return {
    schemaVersion: BROWSER_INPUT_PREPARATION_PROTOCOL_VERSION,
    jobId: "input-test",
    deadlineMs: budget.maxElapsedMs,
    task: {
      type: "prepare-browser-input",
      source: { kind: "file", file },
      role,
      budget: { ...budget },
    },
  } satisfies BrowserInputPreparationRequest;
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.slice().buffer as ArrayBuffer;
}

function fileHandle(name: string, content: string) {
  return {
    kind: "file" as const,
    name,
    async getFile() {
      return new File([content], name);
    },
  };
}

function directory(
  name: string,
  children: Array<ReturnType<typeof fileHandle>>,
) {
  return {
    kind: "directory" as const,
    name,
    async *values() {
      for (const child of children) yield child;
    },
  };
}
