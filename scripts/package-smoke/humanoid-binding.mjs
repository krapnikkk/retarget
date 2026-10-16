// Copied into the tarball consumer directory before execution. All SDK imports
// below must resolve from the installed tarball, never from repository sources.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Worker as NodeWorker } from "node:worker_threads";
import { processHumanoidBinding } from "@krapnik/retarget/io";
import { runNodeToolJob } from "@krapnik/retarget/node";
import { runRetargetJob } from "@krapnik/retarget/browser";

const bytes = Uint8Array.from(readFileSync("binding-input.glb")).buffer;
const joints = JSON.parse(readFileSync("binding-joints.json", "utf8"));
const rig = await processHumanoidBinding(bytes, { operation: "use-rig", joints });
let getterCalls = 0;
const malformed = Object.defineProperty({ operation: "fit" }, "landmarks", { enumerable: true, get() { getterCalls++; return {}; } });
const invalid = await runNodeToolJob({ type: "humanoid-binding", bytes, command: malformed });
assert.equal(invalid.ok, false);
assert.equal(invalid.error.code, "WORKER_PROTOCOL_INVALID");
assert.equal(getterCalls, 0, "Node task validation must precede structured cloning");
const skinTask = { type: "humanoid-binding", bytes, command: { operation: "skin", snapshot: rig, expectedRevision: rig.revision } };
const nodeSkin = await runNodeToolJob(skinTask);
assert.equal(nodeSkin.ok, true, JSON.stringify(nodeSkin));
const snapshot = nodeSkin.result;
const exported = await runNodeToolJob({ type: "humanoid-binding", bytes,
  command: { operation: "export", snapshot, expectedRevision: snapshot.revision } });
assert.equal(exported.ok, true, JSON.stringify(exported));
assert.equal(exported.result.validation.ok, true);
const oversizedValidation = await runNodeToolJob({ type: "humanoid-binding", bytes,
  command: { operation: "validate", snapshot, expectedRevision: snapshot.revision, outputBytes: exported.result.bytes.slice().buffer } },
  { budget: { maxInputBytes: bytes.byteLength } });
assert.equal(oversizedValidation.ok, false);
assert.equal(oversizedValidation.error.code, "PARSE_BUDGET_EXCEEDED");
assert.equal(bytes.byteLength > 0, true, "default Node execution must not detach input");
const nodeAbort = new AbortController();
let nodeStarted = false;
const cancelled = await runNodeToolJob(skinTask, { signal: nodeAbort.signal,
  onProgress(progress) { if (progress.phase === "author") { nodeStarted = true; nodeAbort.abort(); } } });
assert.equal(nodeStarted, true);
assert.equal(cancelled.ok, false);
assert.equal(cancelled.error.code, "OPERATION_CANCELLED");
const timedOut = await runNodeToolJob(skinTask, { budget: { softDeadlineMs: 1 } });
assert.equal(timedOut.ok, false);
assert.equal(timedOut.error.code, "PROCESSING_DEADLINE_EXCEEDED");

// Execute the shipped browser worker using a Node host transport, as the
// existing package gate does. A separate browser run is still required.
class BrowserWorkerTransport extends EventTarget {
  static instances = [];
  terminated = false;
  ready = false;
  pending = [];
  constructor(url) {
    super();
    BrowserWorkerTransport.instances.push(this);
    this.worker = new NodeWorker(new URL("./worker-wrapper.mjs", import.meta.url), { workerData: { workerUrl: url.href } });
    this.worker.on("message", (data) => {
      if (data?.type === "wrapper-ready") {
        this.ready = true;
        for (const request of this.pending) this.worker.postMessage(request);
        this.pending = [];
      } else this.dispatchEvent(new MessageEvent("message", { data }));
    });
    this.worker.on("error", (cause) => {
      const event = new Event("error");
      Object.assign(event, { message: cause.message });
      this.dispatchEvent(event);
    });
  }
  postMessage(request, transfers) {
    const copy = structuredClone(request, { transfer: transfers });
    if (this.ready) this.worker.postMessage(copy);
    else this.pending.push(copy);
  }
  terminate() { this.terminated = true; void this.worker.terminate(); }
}
globalThis.Worker = BrowserWorkerTransport;
try {
  const browserSkin = await runRetargetJob(skinTask);
  assert.deepEqual(browserSkin, snapshot, "packed browser and Node solvers must agree");
  const browserOutput = await runRetargetJob({ type: "humanoid-binding", bytes,
    command: { operation: "export", snapshot: browserSkin, expectedRevision: browserSkin.revision } });
  assert.deepEqual(browserOutput.bytes, exported.result.bytes);
  const controller = new AbortController();
  let started = false;
  await assert.rejects(runRetargetJob(skinTask, { signal: controller.signal,
    onProgress(progress) { if (progress.phase === "solve") { started = true; controller.abort(); } } }), { name: "AbortError" });
  assert.equal(started, true);
  await assert.rejects(runRetargetJob(skinTask, { deadlineMs: 1 }), { code: "PROCESSING_DEADLINE_EXCEEDED" });
  const transferred = bytes.slice(0);
  await runRetargetJob({ type: "humanoid-binding", bytes: transferred, command: { operation: "inspect" } }, { bufferOwnership: "transfer" });
  assert.equal(transferred.byteLength, 0);
  assert.equal(BrowserWorkerTransport.instances.every((worker) => worker.terminated), true);
} finally {
  for (const worker of BrowserWorkerTransport.instances) worker.terminate();
  delete globalThis.Worker;
}
await assert.rejects(runRetargetJob(skinTask), { code: "WORKER_UNAVAILABLE" });
console.log("[ok] packed humanoid binding: Node/browser-worker agreement, real skin export, running cancellation, deadlines, ownership and fail-closed execution");
