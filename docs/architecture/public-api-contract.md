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
  high-level retarget pipeline, and fail-closed Worker execution.
- `3dretarget/io` accepts and returns bytes and serializable data only.
- `3dretarget/node` exposes the byte IO surface plus explicit inline jobs for
  local tools and tests. Inline execution is not re-exported by the browser
  entry.
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
relative Worker URL, and a request/result execution through the packed Worker.
