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

The public humanoid pipeline registry exposes six complete beta combinations:
`gltf-animation` to `gltf-humanoid` with `animated-glb`, `vrma`,
`gltf-animation`, or `motion-json` output; `vrma` to `gltf-humanoid` with
`animated-glb` output; and `gltf-animation` to `vrm` with `baked-vrm` output.
Lookup requires all three format IDs. Calling `pipeline.run(...)` returns the
declared bytes together with the solved motion. The pinned Golden
`gltf-animation -> gltf-humanoid -> animated-glb` case has stronger,
case-scoped Blender and Godot certification.

The browser entry also exposes `runRiggedGLTFPipeline` for non-humanoid rigged
glTF pairs. Its beta scope is intentionally narrower: the pinned Mesh2Motion
Fox Idle/Walk/Run/Jump source matrix to the pinned Fox, Dog, and Horse targets
with Animated GLB output. Other rig families remain experimental.

See [library stability gates](docs/stabilization-gates.md) for the current local
readiness criteria.
