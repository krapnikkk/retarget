# Public API contract

[简体中文](../zh-CN/architecture/public-api-contract.md)

This document records the public npm package surface of `@krapnik/retarget`.
It defines the compatibility boundary for library stabilization.

## Entries

- `@krapnik/retarget` exposes serializable format, profile, canonical motion, rig, and
  structured error contracts. It does not expose `File`, DOM/Worker handles,
  Three.js objects, or glTF-Transform documents.
- `@krapnik/retarget/browser` owns `File`/`AbortSignal` orchestration, the narrow
  high-level retarget pipeline, and fail-closed Worker execution. Pipeline
  lookup requires the motion, avatar, and output format IDs so assurance is
  attached to a complete input-to-output combination rather than a format pair.
  The selected pipeline's `run` method returns the declared output bytes and
  solved motion; `retarget` remains the solve-only operation. Non-humanoid
  rigged glTF uses the separate coarse `runRiggedGLTFPipeline` operation, which
  preserves the same complete input-to-Animated-GLB boundary without exposing
  glTF-Transform or Three.js objects.
- `@krapnik/retarget/browser/input` is the stable input-preparation-only subset. It
  preserves the same `prepareBrowserAssetInput()` contract and dedicated
  Worker URL without including retarget pipelines or format parser runtimes in
  the entry module graph. The full browser entry re-exports it for
  compatibility.
- `@krapnik/retarget/io` accepts and returns bytes and serializable data only.
- `@krapnik/retarget/node` exposes the byte IO surface, an isolated
  `runNodeToolJob` contract for deterministic artifact authoring/validation,
  and explicit inline retarget jobs for trusted local tools and tests. Node
  tooling accepts bytes and serializable metadata only; it owns no filesystem
  traversal or catalog policy. Inline execution is not re-exported by the
  browser entry.
- `@krapnik/retarget/validation` and `@krapnik/retarget/certification` expose serializable
  results and manifests only.

Worker tasks are discriminated messages. `RetargetJobResult<TTask>` maps every
task to its result type, public failures use the single `RetargetErrorCode`
registry, and transferable inputs retain structural validation before parsing.
Product-specific byte and time limits are opt-in consumer policy.
The experimental [humanoid binding](humanoid-binding.md) task separates fitting,
rig/weight editing, skinning, validation and GLB export. It shares versioned
byte/JSON snapshots across browser and Node isolation; trusted tools can use
the explicit `processHumanoidBinding` inline IO operation.
The browser `exportPairedAvatarMotionZip` operation is experimental: it
validates target identity and motion reload, but failures are plain errors
without public codes, it has no cancellation, progress, or budget contract, and
its signature may change in a minor release.
The browser `exportAnimatedGLBStream` operation is experimental and
humanoid-only: it appends a target-bound solved clip to a self-contained GLB and
returns a `Blob` composed from range-backed parts without reading the whole
avatar. A clip bound to another rig fails with `TARGET_RIG_MISMATCH`; other
failures are plain errors, and it has no cancellation, progress, or budget
contract yet.
Avatar exporters accept `TargetBoundSolvedHumanoidMotionClip`, whose target rig
signature prevents a solved clip from being silently rebound to another rig.

Internal parsers, scene/document objects, raw target-binding transforms, ZIP
helpers, and individual format adapters are not public shortcuts. A new use
case must first earn a coarse contract rather than exporting an internal file.

`scripts/verify-package.mjs` enforces declaration boundaries, reports artifact sizes,
tarball installation and imports, a strict TypeScript consumer compile, the
relative browser Worker URLs, a production bundle of the packed browser-input
entry with runtime/module deny lists, and request/result execution through the
packed retarget and Node tooling Workers. See
[Node artifact tooling](node-artifact-tooling.md).
