# Retarget job runtime

[简体中文](../zh-CN/architecture/retarget-job-runtime.md)

Browser-local processing still treats uploaded files as untrusted input. The
job runtime validates format ranges, safe integer arithmetic, and serializable
protocol structure without imposing a product-specific resource policy.

## Worker boundary

`src/workers/retarget.worker.ts` runs one isolated job per Worker. The browser
client terminates that Worker on abort or a caller-selected deadline, so cancellation stops CPU
work instead of merely suppressing a stale callback. Requests and
results use structured messages with a job id, progress phase, error code, and
transferable `ArrayBuffer` payloads.

Bounded browser input preparation uses the separate
`src/workers/input-preparation.worker.ts` entry. The retarget Worker accepts
only retarget protocol tasks and cannot route input-preparation requests into
the solver/importer graph.

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
cannot be safely structured-cloned. Its generated counts are checked for safe
integer overflow before sample arrays are allocated. Avatar authoring still uses the existing
format-specific path; its independent reload and semantic validation run in a
Worker when the output is an in-memory byte array.

## Safety checks and opt-in policy

The library no longer rejects work using default file-size, duration, FPS,
sample-count, estimated-memory, output-byte, or elapsed-time ceilings. Those
thresholds varied by device and product without observed failure evidence.

`src/processing-budget.ts` remains the shared implementation for format-safe
finite values, safe integer multiplication, and explicit caller limits. A
caller may opt into `deadlineMs` or platform-specific Node/browser limits;
positive safe-integer values are accepted without a library ceiling.

`heightScale`, `armOffsetDegrees`, and `playbackSpeed` remain finite and within
their semantic domains. VMD and BVH exporters still calculate expanded counts
before allocation so overflow and explicitly configured limits fail
deterministically. Worker isolation, cancellation, structured failures, and
resource cleanup remain mandatory.

Preview scheduling, cameras, WebGL lifecycle, and presentation remain consumer
responsibilities. They may consume canonical or validated SDK results but do
not define parser, solver, validation, or export behavior.
