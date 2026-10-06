# Humanoid binding

[简体中文](../zh-CN/architecture/humanoid-binding.md)

`humanoid-binding-v1` implements issue #6 as a consumer-neutral, experimental byte/JSON capability. It owns fitting, joint changes, weight generation/editing, validation and GLB export. Editors, gizmos, brushes, persistence, preview scenes and product limits remain consumer responsibilities.

## Supported input

| Area | v1 contract |
| --- | --- |
| Container | Content-probed glTF 2.0 GLB, one scene and one embedded BIN buffer. No external fetches. |
| Pose/fitting | Upright humanoid, metres, +Y up; explicit T/A pose and +Z/-Z facing. Proportional template checked against actual surface samples, with optional world-space joint centres. A-pose requires six arm landmarks. Insufficient evidence requests named landmarks. This is an editable draft, not automatic anatomy recognition. |
| Existing rig | `use-rig` accepts explicit roles, parents and world bind transforms without fitting. Original unweighted nodes are preserved; a canonical skeleton is added for the skin. This command does not infer arbitrary existing skeleton roles. |
| Geometry | Indexed/nonindexed triangles, finite FLOAT VEC3 positions; multiple meshes/primitives and transformed shared instances. Degenerate triangles and unreferenced vertices are rejected. |
| Topology | Open/nonmanifold/disconnected surfaces may be solved independently. Disconnected components produce a review diagnostic. Exact coincident positions within each primitive are welded, including UV/normal seams; coincident separate shells can therefore be coupled. |
| Attributes/resources | Core position/normal/tangent/UV/colour attributes, valid custom attributes, materials and embedded PNG/JPEG bytes are preserved. Attribute vertex counts must agree. Images are not decoded or quality-certified. |
| Transforms | Finite positive-scale TRS, or nonsingular affine non-reflected non-sheared local matrices. Instance world transforms enter inverse binds. Source node indices/transforms remain unchanged. |
| Rejected content | Existing skins/JOINTS/WEIGHTS, animations, morphs, sparse accessors, external resources, camera nodes, multiple scenes and all glTF extensions, including optional extensions. Top-level `extras`, when present, must be an object so namespaced binding metadata can be added without changing the source value's type; object extras are preserved. No silent content removal. |
| Joint edits | Fixed humanoid hierarchy, required roles, unit world quaternions and nonzero bone lengths. Position edits change proportions. Joint scaling/hierarchy edits are unsupported. |

Pose labels do not establish anatomy: callers must confirm the model and draft. v1 has no learned detector, voxel interior, collision handling, mirror constraint, volume preservation or corrective shapes. Clothing, touching limbs, accessories and fingers need particular review.

## Public operations

One coarse task, `{ type: "humanoid-binding", bytes, command }`, has separate `inspect`, `fit`, `use-rig`, `edit-rig`, `skin`, `edit-weights`, `export` and `validate` commands. On every call, `bytes` contains the **original static input**, not an exported skinned GLB. Command types infer result types.

```ts
import { runRetargetJob } from "@krapnikkk/retarget/browser";

const rig = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "fit", pose: "t-pose", forward: "+z", landmarks } });
const edited = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "edit-rig", snapshot: rig, expectedRevision: rig.revision,
    edits: [{ bone: "leftLowerArm", position: elbowWorldPosition }] } });
const skin = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "skin", snapshot: edited, expectedRevision: edited.revision } });
const output = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "export", snapshot: skin, expectedRevision: skin.revision } });
// output.bytes: Uint8Array; output.validation: structural + deformation report.
```

Node uses `runNodeToolJob` from `@krapnikkk/retarget/node`, returning `{ ok, result }` or `{ ok: false, error }`. Trusted tooling can explicitly run inline with `processHumanoidBinding(bytes, command, options)` from `@krapnikkk/retarget/io`. No scene/document objects leak through these contracts.

## Editing and invalidation

Snapshots are JSON round-trippable schema version 1 values. Store original bytes separately. Asset SHA-256 and topology plus `node:N/mesh:M/primitive:P` identify fixed vertex addresses, including shared-mesh instances. Even metadata-only asset changes reject old snapshots; there is no implicit migration.

`revision` hashes the complete snapshot; `rigRevision` hashes full joint data. These are content identities, not clocks or authentication. No-op edits can retain a revision. `expectedRevision` must match the snapshot actually edited. The library is stateless: consumers must compare their current revision with the revision captured at dispatch before applying a late result. Matching old snapshot/token data cannot reveal newer consumer state.

Joint positions/rotations are absolute scene-world values. Descendants do not move implicitly; submit every intended change. Bind-transform edits clear weights/provenance, retain locks, and require reskinning. Exported joint metadata carries the new rig revision into existing target signatures. Old bound motion fails with `TARGET_RIG_MISMATCH` in normal and streamed exporters. Weight-only edits preserve rig identity. The generated GLB remains the explicit Target in `Source -> Canonical -> Target`.

Each `edit-weights` row addresses a primitive ID and vertex. `influences` replaces unlocked candidates. Positive candidates sort by weight, then canonical role order, and are pruned/normalized; zero-total rows and invalid/duplicate roles fail. `locks` replaces row constraints; `[]` unlocks. A zero lock excludes a bone. Positive locks are exact in JSON and reserve output slots; remaining mass goes to positive unlocked candidates. Excess locked mass, more than four positive locks, or no available candidate/slot returns `BINDING_CONSTRAINT_CONFLICT`. Reskinning retains locks but replaces unlocked manual edits. Locks affect their own vertices, not neighbour diffusion.

Four influences are a **v1 output profile**, not a universal glTF limit. Weight-sum tolerance is `1e-6`; GLB FLOAT storage rounds double-precision edited weights. Rest/deformation position tolerance is `max(1e-6 metres, characterHeight * 2e-5)`.

## Algorithm, budgets and reproducibility

`surface-heat-v1` is an original baseline: nearest bone-segment seeds, screened Jacobi diffusion over exact-welded triangle adjacency, then constrained four-influence normalization. It is not Blender bone heat, voxel heat, BBW or ML, and copies no application code. `iterations` is an integer from 1 through 256 (default 32). Terminal segments extrapolate; branch joints use the first child in canonical role order.

No randomness, clocks or locale-dependent sorting enter snapshots/GLB. Identical bytes, command data/order, algorithm/options and pinned toolchain reproduce bytes. Repeated runs and Node/Chromium equality are tested on the named fixture. Byte identity across arbitrary engines/toolchains is not guaranteed; Float64 computation, Float32 storage and semantic tolerances define the numerical boundary. JSON key order belongs to the snapshot representation: standard stringify/parse is supported, arbitrary reordering is not.

Browser options include `signal`, `onProgress`, `deadlineMs`, `bufferOwnership` and `budget: { parse, processing }`. Default ownership performs one `postMessage` copy; transfer detaches inputs. Large snapshot request checks yield between bounded chunks. Snapshot results use internal Transferable joint/weight buffers, then cooperatively reconstruct and verify the complete JSON revision and every weight on the main side. This transport is not a public snapshot type. Cancellation and hard deadlines terminate the worker; inner loops also checkpoint. Missing Worker support fails closed. Node exposes corresponding platform options and `budget.softDeadlineMs`, also enforced as a hard limit by the parent.

Consumers choose byte, vertex/index/bone and generated-value budgets. `maxGeneratedValues` bounds decoded accessor scalar counts and the estimate `vertices * joints * (iterations + 3)`. Alongside byte/index bounds this constrains work; it is not a measured peak-RAM quota. No product file-size/time default is introduced. Output is bounded before reload. Progress reports stages, not predicted completion time.

Public errors distinguish `BINDING_INPUT_UNSUPPORTED`, `BINDING_LANDMARKS_REQUIRED`, `BINDING_RIG_INVALID`, `BINDING_EDIT_STALE`, `BINDING_WEIGHTS_INVALID`, `BINDING_CONSTRAINT_CONFLICT`, parse/processing budgets, deadlines and cancellation. Browser cancellation is `AbortError`; Node reports `OPERATION_CANCELLED`.

## Evidence and issue #6 audit

The [fixture manifest and evidence guide](../../tests/binding/README.md) record rights, derivation, quality limits and exact ecosystem receipts. Both T-pose paths pass reload, independent five-pose vertex comparison, retargeted animation checks, and pinned Blender 5.2.0 LTS/Godot 4.7.1 import/playback. Blender also samples evaluated vertices. Godot is a headless bone-playback check, not GPU rendering evidence. The derived A-pose has local quality/semantic tests, not separate ecosystem certification. All API outputs remain **experimental**.

| Acceptance | Evidence |
| --- | --- |
| Bare mesh and existing rig | Two legal pinned cases; source weights removed before solving. |
| Joint correction/old motion invalidation | Edited bind transforms; normal and streamed exporter integration. |
| Editable weights/restoration | Normalization, pruning, locks/unlocks/conflicts, JSON restore, stale input tests. |
| Real skin and bind surface | All vertices at five poses, valid weights/joints/IBMs, corruption counterexample. |
| Resource preservation | Transformed shared instances, multi-primitives, embedded texture, attribute-loss rejection. |
| Quality distinct from validity | Shoulder/elbow/hip/knee artist-reference metrics and failing all-hips counterexample. |
| Explicit target and ecosystem | Existing retarget pipeline, native browser vertex playback, two pinned DCC/engine receipts. |
| Conservative assurance | Experimental API results; exact-case evidence does not promote unrelated inputs. |
| Negative paths | Malformed buffers, extensions, transforms, cycles, degenerate/unreferenced geometry, constraints, budgets, stale edits and running cancellation. Disconnected surfaces are accepted with diagnostics. |
| Package and execution | Installed-tarball declarations/entry tests, Node and shipped browser worker execution; separate native Chromium run including 100k-vertex call-return, first-progress, resolve and total timing plus a main-thread heartbeat gate. |

Run `pnpm test:slow` while developing binding, `pnpm verify` for all repository gates, and `pnpm verify:binding:ecosystem` for external runtimes. Regenerated receipts/locks may land with the change that caused them. No consumer repository is a gate.
