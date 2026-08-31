# 3dretarget

[简体中文](README.zh-CN.md)

`3dretarget` is a consumer-neutral motion-retargeting library. It provides
bounded format probing, source normalization, canonical motion, rig inspection,
target solving, semantic validation, export, format-safety validation, and a
cancellable browser Worker runtime plus isolated Node artifact tooling.

Version `0.7.2` is the provider side of the consumer engine cutover. The package
remains private in registry metadata until an approved private-registry publish
is performed; a sibling checkout may be used for coordinated development but
is not release evidence. Its roadmap and readiness are determined by reusable
retargeting capabilities rather than any particular application.

## Scope

This repository owns:

- reusable `Source -> Canonical -> Target` behavior;
- serializable public contracts and platform-specific adapters;
- correctness, security, diagnostics, and compatibility evidence;
- reproducible fixtures and certification manifests.

It does not own product UI, application state, catalogs, analytics, hosting, or
deployment. Consumer-specific integration code and acceptance tests belong to
the consuming application.

## Development

```powershell
pnpm install
pnpm hooks:install # once per checkout
pnpm verify
pnpm verify:ecosystem # requires the pinned Blender and Godot builds
```

This private repository uses the versioned local pre-commit hook as its normal
commit gate. Every commit runs `pnpm verify`; hosted CI is reserved for manual
release/review use so limited CI capacity is not spent on routine commits.
`git commit --no-verify` is an emergency bypass, not proof of a passing change,
and must be followed by a recorded successful `pnpm verify` before handoff.

Large research corpora are downloaded into the ignored `references/` directory.
Committed fixtures include provenance and hashes.

## Controlled release

Consumers must install and pin the exact `0.7.2` version from the approved
private registry and use only the documented public entries. Local `pnpm pack`
output is a package-verification artifact, not the consumer distribution path.
Package version `0.7.2` denotes initial API development; capability
assurance remains case-scoped as `experimental`, `beta`, or `certified`.
Experimental paths are available for evaluation but are not supported as
production-compatible combinations. The supported Node toolchain is the
version declared in `package.json`.

The MIT license covers this library code. It does not relicense consumer
assets, user inputs, generated outputs, or separately installed dependencies.

## Public entries

- `3dretarget`: serializable formats, profiles, motion, rig, pipeline, and error
  contracts.
- `3dretarget/browser`: content-first bounded `File`/package preparation,
  explicit resource disposal, and fail-closed Worker execution.
- `3dretarget/browser/input`: the input-preparation-only browser surface. Use
  this entry when a consumer does not need retarget pipelines or format parser
  runtimes in its main bundle.
- `3dretarget/io`: byte-oriented motion import/export without DOM or scene
  objects.
- `3dretarget/node`: byte-oriented IO, isolated deterministic VRM/PMX and Rig
  Motion glTF authoring/validation jobs, plus explicit trusted inline retarget
  jobs. It exposes no filesystem traversal or generic ZIP API.
- `3dretarget/validation`: serializable semantic validation results.
- `3dretarget/certification`: provenance and assurance manifests.

The public humanoid pipeline registry exposes nine complete beta combinations:
`gltf-animation` to `gltf-humanoid` with `animated-glb`, `fbx-animation`,
`vrma`, `gltf-animation`, or `motion-json` output; `vrma` to `gltf-humanoid`
with `animated-glb` output; and `gltf-animation`, `bvh`, or `vmd` to `vrm`
with `baked-vrm` output.
Lookup requires all three format IDs. Calling `pipeline.run(...)` returns the
declared bytes together with the solved motion. The pinned Golden
`gltf-animation -> gltf-humanoid -> animated-glb` case has stronger,
case-scoped Blender and Godot certification.

The browser entry also exposes `runRiggedGLTFPipeline` for non-humanoid rigged
glTF pairs. Its beta scope covers five pinned Mesh2Motion family matrices with
Animated GLB output: Fox quadruped (12 action/target pairs), Bird/Eagle (4),
Snake (7), Spider (9), and Dragon (4). These 36 pairs are fixture- and
profile-scoped; they do not generalize to arbitrary rigged glTF pairs.

See [library stability gates](docs/stabilization-gates.md) for the current local
readiness criteria.
