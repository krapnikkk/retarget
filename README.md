# 3dretarget

[简体中文](README.zh-CN.md)

`3dretarget` is a consumer-neutral motion-retargeting library. It provides
bounded format probing, source normalization, canonical motion, rig inspection,
target solving, semantic validation, export, processing budgets, and a
cancellable browser Worker runtime.

The package is currently private and maintained locally while its public API,
correctness evidence, and packed Worker contract stabilize. Its roadmap and
readiness are determined by reusable retargeting capabilities rather than any
particular application.

## Scope

This repository owns:

- reusable `Source -> Canonical -> Target` behavior;
- serializable public contracts and platform-specific adapters;
- correctness, security, resource-budget, and compatibility evidence;
- reproducible fixtures and certification manifests.

It does not own product UI, application state, catalogs, analytics, hosting, or
deployment. Consumer-specific integration code and acceptance tests belong to
the consuming application.

## Development

```powershell
pnpm install
pnpm verify
pnpm verify:ecosystem # requires the pinned Blender and Godot builds
```

Large research corpora are downloaded into the ignored `references/` directory.
Committed fixtures include provenance and hashes.

## Public entries

- `3dretarget`: serializable formats, profiles, motion, rig, pipeline, and error
  contracts.
- `3dretarget/browser`: `File` adapters and fail-closed Worker execution.
- `3dretarget/io`: byte-oriented motion import/export without DOM or scene
  objects.
- `3dretarget/node`: explicit local inline jobs plus the byte-oriented IO
  surface.
- `3dretarget/validation`: serializable semantic validation results.
- `3dretarget/certification`: provenance and assurance manifests.

The public pipeline registry currently exposes one complete beta combination:
`gltf-animation -> gltf-humanoid -> animated-glb`. Lookup requires all three
format IDs; other implemented combinations remain experimental and
`getRetargetPipeline` returns `null` for them. The pinned Golden Motion case
inside this beta capability has stronger, case-scoped certified evidence from
Blender and Godot. Calling `pipeline.run(...)` executes this public end-to-end
path and returns the `animated-glb` bytes together with the solved motion.

See [library stability gates](docs/stabilization-gates.md) for the current local
readiness criteria.
