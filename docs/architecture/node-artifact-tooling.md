# Node artifact tooling

[简体中文](../zh-CN/architecture/node-artifact-tooling.md)

`@krapnikkk/retarget/node` exposes `runNodeToolJob` as the coarse Node authoring and
validation boundary. The runner starts the packed Node tooling Worker and never
falls back to in-process execution. An `AbortSignal` or an optional caller deadline
terminates the Worker, including while synchronous parsers or writers are busy.

## Contract

Tasks accept `ArrayBuffer` inputs and serializable metadata. Results are a
discriminated success/failure value with stable `RetargetErrorCode` failures,
phase progress, and structured diagnostics. Public declarations do not expose
`File`, filesystem paths, Three.js objects, glTF-Transform `Document`, or raw ZIP
helpers.

The first task set covers:

- rigged glTF inspection and Rig Motion v2 import;
- deterministic Rig Motion glTF export plus structural and semantic reload;
- deterministic canonical GLB to VRM authoring;
- deterministic canonical GLB to PMX or complete PMX bundle authoring, marked
  experimental because leg IK, physics, and morph authoring remain out of scope;
- validation of VRM, PMX, PMX bundles, and Rig Motion glTF bytes.

Format capability tables are exported by the root package, while provenance and
assurance manifests remain in `@krapnikkk/retarget/certification`. The Node entry does not
duplicate catalog or certification policy.

## Determinism

Artifact names, canonical input bytes, metadata, options, and Rig Motion
`createdAt` values are explicit inputs. Writers do not read the clock or a local
path. The PMX bundle writer uses fixed ZIP metadata and canonical entry order.
Every authored artifact returns its name, byte length, media type, assurance,
SHA-256, bytes, and layered validation report.

Structural, semantic, and ecosystem evidence remain separate. A character
artifact with no motion reports semantic validation as `not-applicable`;
ecosystem evidence is `not-run` unless a pinned external receipt is evaluated
separately.

## Ownership

The library owns authoring semantics, format-safety bounds, rig inspection, validation, and
diagnostics. Consumers own directory traversal, filesystem writes, catalog
schemas, slugs, publication flags, attribution policy, lock layout, cleanup, and
release publication. Generic ZIP creation/reading remains internal and is used
only behind format-specific bundle operations.

Node jobs have no default file-size, output-size, estimated-memory, or elapsed-
time ceiling. `RunNodeToolJobOptions.budget` remains an opt-in consumer policy;
positive values are validated but not clamped to library-owned maxima. ZIP
entry-count, expanded-byte, and compression-ratio defenses remain active.
Inputs are copied into the Worker by default. A caller that will not reuse its
input buffers may set `bufferOwnership: "transfer"`; only task-declared byte
fields are transferred and detached.

```ts
import { runNodeToolJob } from "@krapnikkk/retarget/node";

const result = await runNodeToolJob({
  type: "author-vrm",
  artifactName: "avatar.vrm",
  canonicalGLBBytes,
  metadata: {
    name: "Avatar",
    author: "Example author",
    license: "CC0-1.0",
  },
});

if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
await writeArtifact(result.result.artifact);
```
