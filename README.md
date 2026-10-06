# 3dretarget

[简体中文](https://github.com/krapnikkk/3dretarget/blob/main/README.zh-CN.md)

`3dretarget` is a consumer-neutral TypeScript library for bounded probing of
untrusted 3D files and explicit `Source -> Canonical -> Target` animation
retargeting. It provides source normalization, rig inspection, target solving,
semantic validation, and export through a cancellable browser Worker runtime
and Node tooling.

## Install

```sh
npm install 3dretarget
```

## Requirements

- ESM-only; CommonJS is not supported.
- Node >= 24.11.0 for `3dretarget/node` and `3dretarget/io`.
- Browsers must support module Workers.
- Bundlers must support `new Worker(new URL("...", import.meta.url), { type: "module" })`,
  such as Vite, webpack 5, or Rollup with a Worker plugin.

## Public entries

| Entry | Purpose |
| --- | --- |
| `3dretarget` | Serializable format, profile, motion, rig, pipeline, and error contracts. |
| `3dretarget/browser` | Content-first bounded File/package preparation, explicit disposal, and fail-closed Worker execution. |
| `3dretarget/browser/input` | Input preparation only, without retarget pipelines or format parser runtimes in the main bundle. |
| `3dretarget/io` | Byte-oriented motion import/export without DOM or scene objects. |
| `3dretarget/node` | Byte IO, isolated deterministic VRM/PMX and Rig Motion glTF authoring/validation jobs, and explicit trusted inline retarget jobs; no filesystem traversal or generic ZIP API. |
| `3dretarget/validation` | Serializable semantic validation results. |
| `3dretarget/certification` | Provenance and assurance manifests. |

## Quick start

Probe a user-selected motion file in a Worker. Inspect the selection's status
and format before choosing a pipeline; always dispose of prepared resources.

```ts
import { prepareBrowserAssetInput } from "3dretarget/browser/input";

export async function inspectMotion(file: File, signal?: AbortSignal) {
  const prepared = await prepareBrowserAssetInput(file, { role: "motion", signal });
  try {
    return prepared.selection;
  } finally {
    prepared.dispose();
  }
}
```

For a file identified as BVH, import canonical motion through the browser
Worker. Pass an AbortSignal to cancel the job.

```ts
import { runRetargetJob } from "3dretarget/browser";

export async function importMotion(file: File, signal?: AbortSignal) {
  return runRetargetJob(
    {
      type: "import-motion",
      formatId: "bvh",
      filename: file.name,
      bytes: await file.arrayBuffer(),
    },
    { signal },
  );
}
```

Node tools can import BVH bytes directly through the IO entry:

```ts
import { importBVH } from "3dretarget/io";

export function importMotionBytes(bytes: Uint8Array) {
  const motion = importBVH(bytes, "walk.bvh");
  return { duration: motion.duration, tracks: motion.tracks };
}
```

## Supported combinations and assurance

Assurance is case-scoped: `experimental` capabilities are evaluation-only;
`beta` combinations have the declared fixture/profile evidence; `certified`
cases additionally have structural reload, semantic comparison, and pinned
ecosystem evidence. Before 1.0, APIs may change between minor releases.

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

## Errors and safety

Public failures use structured codes from the
[error-code registry](https://github.com/krapnikkk/3dretarget/blob/main/docs/architecture/error-code-registry.md).
Browser preparation and Worker jobs support cancellation through AbortSignal.
Treat files as untrusted: filenames are hints, content probes are bounded,
and parsing and archive handling retain format-safety bounds. Product-specific
file-size, elapsed-time, and memory policies belong to the consumer.

## Documentation

- [Documentation map](https://github.com/krapnikkk/3dretarget/blob/main/docs/README.md)
- [Public API contract](https://github.com/krapnikkk/3dretarget/blob/main/docs/architecture/public-api-contract.md)
- [Browser input preparation](https://github.com/krapnikkk/3dretarget/blob/main/docs/architecture/browser-input-preparation.md)
- [Node artifact tooling](https://github.com/krapnikkk/3dretarget/blob/main/docs/architecture/node-artifact-tooling.md)
- [Library stability gates](https://github.com/krapnikkk/3dretarget/blob/main/docs/stabilization-gates.md)
- [Supply-chain and release procedure](https://github.com/krapnikkk/3dretarget/blob/main/docs/supply-chain-security.md)
- [Security policy](https://github.com/krapnikkk/3dretarget/blob/main/SECURITY.md)

## Development

```sh
pnpm install
pnpm hooks:install # once per checkout
pnpm check        # architecture rule, type check, unit tests (pre-commit)
pnpm test:slow    # CPU-heavy real-fixture tests
pnpm verify       # full release gate, also run by prepublishOnly
pnpm verify:ecosystem # requires the pinned Blender and Godot builds
```

The versioned pre-commit hook runs `pnpm check`. `pnpm verify` adds
coverage, certification receipts, fixtures, and package verification. Large research corpora stay
in ignored `references/`; committed fixtures include provenance and hashes.

## License

[MIT](https://github.com/krapnikkk/3dretarget/blob/main/LICENSE). The license covers library code; it does not relicense
user assets, inputs, outputs, or separately installed dependencies. See
[third-party notices](https://github.com/krapnikkk/3dretarget/blob/main/THIRD_PARTY_NOTICES.md).
