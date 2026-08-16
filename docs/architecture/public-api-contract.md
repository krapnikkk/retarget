# Local public API contract

[简体中文](../zh-CN/architecture/public-api-contract.md)

This review records the package surface while `3dretarget` remains private and
locally maintained. It is a compatibility boundary for stabilization, not a
registry publication promise.

## Entries

- `3dretarget` exposes serializable format, profile, canonical motion, rig, and
  structured error contracts. It does not expose `File`, DOM/Worker handles,
  Three.js objects, or glTF-Transform documents.
- `3dretarget/browser` owns `File`/`AbortSignal` orchestration, the narrow
  high-level retarget pipeline, and fail-closed Worker execution. Pipeline
  lookup requires the motion, avatar, and output format IDs so assurance is
  attached to a complete input-to-output combination rather than a format pair.
  The selected pipeline's `run` method returns the declared output bytes and
  solved motion; `retarget` remains the solve-only operation. Non-humanoid
  rigged glTF uses the separate coarse `runRiggedGLTFPipeline` operation, which
  preserves the same complete input-to-Animated-GLB boundary without exposing
  glTF-Transform or Three.js objects.
- `3dretarget/browser/input` is the stable input-preparation-only subset. It
  preserves the same `prepareBrowserAssetInput()` contract and dedicated
  Worker URL without including retarget pipelines or format parser runtimes in
  the entry module graph. The full browser entry re-exports it for
  compatibility.
- `3dretarget/io` accepts and returns bytes and serializable data only.
- `3dretarget/node` exposes the byte IO surface, an isolated
  `runNodeToolJob` contract for deterministic artifact authoring/validation,
  and explicit inline retarget jobs for trusted local tools and tests. Node
  tooling accepts bytes and serializable metadata only; it owns no filesystem
  traversal or catalog policy. Inline execution is not re-exported by the
  browser entry.
- `3dretarget/validation` and `3dretarget/certification` expose serializable
  results and manifests only.

Worker tasks are discriminated messages. `RetargetJobResult<TTask>` maps every
task to its result type, public failures use the single `RetargetErrorCode`
registry, and transferable inputs remain bounded before they reach parsing.
Avatar exporters accept `TargetBoundSolvedHumanoidMotionClip`, whose target rig
signature prevents a solved clip from being silently rebound to another rig.

Internal parsers, scene/document objects, raw target-binding transforms, ZIP
helpers, and individual format adapters are not public shortcuts. A new use
case must first earn a coarse contract rather than exporting an internal file.

`scripts/verify-package.mjs` enforces declaration boundaries, size baselines,
tarball installation and imports, a strict TypeScript consumer compile, the
relative browser Worker URLs, a production bundle of the packed browser-input
entry with runtime/module deny lists, and request/result execution through the
packed retarget and Node tooling Workers. See
[Node artifact tooling](node-artifact-tooling.md).
