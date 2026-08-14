# Retarget job runtime

[简体中文](../zh-CN/architecture/retarget-job-runtime.md)

Browser-local processing still treats uploaded files as untrusted input. The
job runtime applies one processing budget after parser-level byte budgets and
before any operation that can multiply frames, tracks, or output bytes.

## Worker boundary

`src/workers/retarget.worker.ts` runs one isolated job per Worker. The browser
client terminates that Worker on abort or deadline, so cancellation stops CPU
work instead of merely suppressing a stale callback. Requests and
results use structured messages with a job id, progress phase, error code, and
transferable `ArrayBuffer` payloads.

`runRetargetJob()` uses `bufferOwnership: "copy"` by default: it clones the
task first, transfers only the worker-owned clone, and leaves caller buffers
attached. Trusted high-throughput callers may explicitly select `"transfer"`;
that choice detaches their input buffers. Transfer lists are recursively
collected and deduplicated. Success, failure, abort, timeout, clone errors,
`messageerror`, and progress-callback failures all converge on the same Worker
cleanup path.

Retarget messages use protocol schema version `1`. Both sides validate the
version, task/response discriminator, registered format IDs, bounded core
fields, progress values, registered error codes, and the task-specific success
result. Unknown task or format values fail closed and never fall through to a
different importer, exporter, or validation route.

The active worker routes are:

```text
binary BVH / VMD / VRMA / GLB import -> parse -> normalize
serializable canonical clip + target rig -> solve -> refine
canonical clip -> motion export
export bytes -> structural reload -> semantic comparison
```

Text glTF with package-relative resources remains on the main thread because
its package URL registry is document-owned. The dedicated Mixamo solver also
remains on the main thread because Three.js scene graphs and AnimationMixers
cannot be safely structured-cloned. It is guarded by the same solve budget
before sample arrays are allocated. Avatar authoring still uses the existing
format-specific path; its independent reload and semantic validation run in a
Worker when the output is an in-memory byte array.

## Default hard limits

The limits in `src/jobs/processing-budget.ts` are derived from the shared
parser budget and are intentionally centralized:

- duration: 20 minutes;
- FPS: 1 through 120;
- generated frames per track: 150,000;
- total source or generated bone samples: 4,000,000;
- generated scalar values: 12,000,000;
- output bytes: 256 MiB;
- per-job deadline: 45 seconds.

`heightScale`, `armOffsetDegrees`, and `playbackSpeed` must also be finite and
within product ranges. VMD and BVH exporters calculate their expanded frame and
byte cost before allocating the output. These limits are not assurance claims;
they only bound resource use.

Preview scheduling, cameras, WebGL lifecycle, and presentation remain consumer
responsibilities. They may consume canonical or validated SDK results but do
not define parser, solver, validation, or export behavior.
