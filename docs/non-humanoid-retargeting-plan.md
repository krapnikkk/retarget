# Non-humanoid Retargeting Contract

[简体中文](zh-CN/non-humanoid-retargeting-plan.md)

This document defines the bounded non-humanoid product line. It replaces the
assumption that every glTF character and every glTF animation can be paired
through humanoid bone names.

## Product boundary

Supported inputs are **already-rigged** characters matching an explicit active
definition: `quadruped-v1`, `avian-v1`, `serpentine-v1`, `arachnid-v1`, or
`creature-v1`. The product does not create an armature, generate skin weights,
infer arbitrary creature semantics, or promise that unrelated topologies are
compatible. `creature-v1` is the explicit dragon composition (body, four legs,
wings, and tail), not an arbitrary-rig escape hatch.

The complete v1 path is:

```txt
rigged non-humanoid glTF/GLB motion
+ rigged character with the same active definition
-> inspect family and definition
-> map semantic roles
-> same rest-node-skin signature copy or definition-mapped swing/twist solve
-> preview
-> Rig Motion JSON v2 / glTF Animation / Animated GLB
```

Humanoid Motion JSON v1 and all existing humanoid pipelines remain supported
without migration. A file format such as GLB does not imply a rig family.

## Semantic layers

The implementation uses four separate concepts:

1. **Rig family** — a broad anatomy, for example `humanoid` or `quadruped`.
2. **Rig definition** — stable semantic roles, required chains, contacts, and
   scale rules for one family revision, for example `quadruped-v1`.
3. **Rig profile** — aliases and rest/axis conventions for a concrete rig
   ecosystem, for example `mesh2motion-fox`.
4. **Solver** — selected from source and target definitions. File-format IDs
   are never sufficient to select a solver.

The five active non-humanoid definitions each have a definition, canonical and
Mesh2Motion profile, pinned CC0 fixture, solver route, and acceptance evidence.
Adding a family identifier alone is never a support claim.

## Family modules

- `quadruped-v1`: body/neck, four leg chains, four paw contacts, optional tail.
- `avian-v1`: body, paired wings, paired legs/feet, and tail feathers.
- `serpentine-v1`: head/neck plus a normalized variable-length axial chain;
  source rotations are resampled onto the target chain length.
- `arachnid-v1`: body plus eight ordinal radial leg chains and eight contacts.
- `creature-v1`: an explicit dragon module combining body, four legs, paired
  wings, and tail.

## `quadruped-v1`

Required roles:

```txt
root, pelvis, spine, chest, neck, head,
frontLeft.upper, frontLeft.lower, frontLeft.paw,
frontRight.upper, frontRight.lower, frontRight.paw,
hindLeft.upper, hindLeft.lower, hindLeft.paw,
hindRight.upper, hindRight.lower, hindRight.paw
```

Optional roles add intermediate spine/upper-spine joints, shoulders/hips,
ankles, toes/toe bases, jaw, ears, and a five-segment tail. These optional
roles preserve detailed ecosystem tracks (including the full Mesh2Motion Fox
spine, feet, and tail) without making those extra segments mandatory for a
canonical quadruped.
Optional roles improve detail but cannot make an otherwise incomplete required
chain pass validation.

Required chains are body, neck, and all four legs. Paw roles are contact roles.
Root translation is transferred only through `root`; other translation tracks
are intentionally ignored in v1. Scale is derived from mapped rest-pose spans,
not a hard-coded animal height.

## Motion protocol

Rig Motion JSON v2 is a parallel protocol, not an in-place mutation of the
humanoid v1 schema. Every track addresses a semantic `role`; the document also
records the source definition/profile/signature and rest pose required to
transfer local deltas correctly.

```json
{
  "schemaVersion": 2,
  "rigDefinitionId": "quadruped-v1",
  "family": "quadruped",
  "tracks": [
    { "role": "frontLeft.upper", "path": "rotation", "times": [0], "values": [0, 0, 0, 1] }
  ]
}
```

## Solver rules

- Matching rest-node-skin v2 signatures take the identity-copy fast path.
- Different signatures with the same active definition use rest-pose-aware
  chain swing/twist transfer.
- Local rotation deltas are decomposed around each role's rest child axis,
  mapped into the target rest axis, and recomposed on the target rest rotation.
- Root translation is converted from source-rest-relative motion and scaled by
  the target/source rest-pose span.
- A family or definition mismatch is a hard compatibility error. It is never a
  warning followed by a best-effort humanoid solve.
- Required chain coverage must be 100%. Optional roles may be absent.

## Output matrix

| Output | Humanoid v1 | Active non-humanoid v1 definitions |
|---|---:|---:|
| Motion JSON | Humanoid Motion JSON v1 | Rig Motion JSON v2 |
| glTF Animation | yes | yes |
| Animated GLB | yes | yes |
| VRMA / baked VRM | yes | blocked |
| VMD / PMX | yes where supported | blocked |
| BVH | yes | blocked |
| FBX | yes where supported | blocked in v1 |

The Studio and catalog must derive these choices from the rig definition. They
must not show a disabled ecosystem output as if the conversion had succeeded.

## Catalog metadata and pairing

Every generated asset records:

```json
{
  "rigFamily": "quadruped",
  "rigDefinitionId": "quadruped-v1",
  "rigProfileId": "canonical-quadruped-v1"
}
```

Fixture admission validates the declared definition against the GLB. Consumer
catalogs and interfaces are responsible for filtering incompatible selections;
they must use the SDK compatibility result rather than infer compatibility from
file names.

## Studio inspection and recipes

The Studio exposes detected family/definition/profile, an explicit family and
profile override, visual chain-start/chain-end mapping, and JSON recipe
import/export. Its linked dual viewport can freeze both sides in rest pose and
draw each mapped joint's local axes. Diagnostics report required-chain
coverage, topology conflicts, missing axes, root scale, contacts and grounded
drift, and loop-boundary rotation/root deltas. A recipe does not contain or
redistribute either user asset.

## Fixture and acceptance matrix

Fixtures under `tests/fixtures/non-humanoid/mesh2motion` are pinned to
Mesh2Motion commit `a9bf18a6007d7e12d197657f023f77a5e33473fe`. Upstream
explicitly dedicates all models, rigs, and animations to CC0 1.0; every file is
recorded with its source path and SHA-256. The quadruped fixture set covers:

1. canonical identity motion (same skeleton/signature),
2. different proportions and local bone axes,
3. missing required front paw (hard failure),
4. optional tail absent (pass),
5. humanoid/quadruped pairing (hard compatibility failure),
6. all four paw contacts and translated root,
7. Animated GLB reload followed by actual Three.js playback,
8. Fox Idle/Walk/Run/Jump against Fox, Dog, and Horse proportions,
9. serializable mapping diagnostics for consumer-owned visualization.

Bird, Snake, Spider, and Dragon fixtures cover all four NH3 definitions,
including a 20-joint-to-8-joint serpentine resampling case. Unrigged reference
meshes are rejected at the inspection boundary.

SDK acceptance requires:

- identity/rest samples remain unchanged within quaternion tolerance;
- all required chains map at 100%;
- family-incompatible pairs are rejected by the compatibility API;
- diagnostics report source/target signature, root scale, contacts and drift,
  loop boundary, topology conflicts, local-axis warnings, and missing roles;
- Rig Motion v2 JSON round-trips;
- exported glTF Animation and Animated GLB reload with the expected channels,
  then advance through Three.js `AnimationMixer`;
- existing humanoid, browser-runtime, and export tests remain green.

The generated acceptance record and its certification hash live at
`docs/generated/non-humanoid-v1-certification.json`. Fixture admission does not
make an asset a public catalog entry; catalog publication keeps its separate
manifest, integrity, preview, and release gates.
