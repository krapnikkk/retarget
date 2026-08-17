# Export Combination Contract

[简体中文](zh-CN/export-combination-plan.md)

This document describes dispatch and evidence boundaries. It deliberately does
not duplicate the live format or adapter matrices.

## Current-state sources

| Concern | Authoritative source |
| --- | --- |
| Format catalog and assurance | `src/formats/catalog.ts` |
| Callable export adapters | `src/adapters/export/index.ts` |
| Humanoid motion/avatar pairings | `src/pipelines/registry.ts` |
| Rig-family output capabilities | `src/rigs/capabilities.ts` |
| Humanoid certification cases | `src/certification/golden-motion-v1.json` |
| Golden fixture provenance | `tests/fixtures/certification/golden-motion/` |

Tests must fail when these sources disagree. A Markdown table is never the
authority for enabling an export.

## Assurance model

The format catalog contains implemented formats. `assurance` records the
evidence behind an exact capability:

- `experimental` means structural or semantic evidence is incomplete.
- `beta` requires locked structural and semantic evidence for the exact case.
- `certified` additionally requires named, pinned ecosystem compatibility
  evidence. A label alone cannot promote a case.

Certification is scoped to the complete tuple:

```text
motion format x avatar format x export format
x execution mode x rig detection mode
x solver revision x target-binding revision
```

Accordingly, public humanoid pipeline lookup requires the motion, avatar, and
export format IDs. The registry admits nine beta combinations: five
`gltf-animation -> gltf-humanoid` outputs (`animated-glb`, `fbx-animation`,
`vrma`, `gltf-animation`, and `motion-json`),
`vrma -> gltf-humanoid -> animated-glb`, and `gltf-animation`, `bvh`, or `vmd`
to `vrm -> baked-vrm`. Their pinned cases have structural
reload and independent semantic evidence. Only the first pinned Golden Motion
case is independently certified in Blender and Godot.

Non-humanoid rigged glTF uses the separate coarse browser entry
`runRiggedGLTFPipeline`. Five pinned family matrices are beta for Animated GLB:
Fox quadruped, Bird/Eagle, Snake, Spider, and Dragon. Their 36 locked
action/target pairs do not generalize to every rigged glTF pair.

## Dispatch boundaries

- Motion-only exporters consume canonical or retargeted motion and do not
  invent an avatar.
- Avatar exporters that promise a combined scene require a target avatar and a
  bound retargeted motion unless their adapter contract explicitly says
  otherwise.
- Standalone character FBX is intentionally unavailable while the active FBX
  scene writer requires bound motion.
- `VRM + external VRMA` is a package contract, not a single renamed file.
- Animated PMX and canonical-GLB-to-PMX model authoring are distinct
  experimental capabilities. PMX has no standard embedded animation timeline;
  the normal MMD delivery remains a model plus VMD where compatible.
- Non-humanoid outputs are selected by rig definition through
  `src/rigs/capabilities.ts`. A GLB extension does not imply humanoid or
  creature compatibility.
- Import probes, solvers, validation, and exporters preserve the explicit
  `Source -> Canonical -> Target` boundary.

## Evidence boundary

Structural reload proves only that the emitted bytes can be parsed again.
Semantic comparison independently checks target-world motion. Ecosystem
compatibility independently checks a named external consumer. Receipts and UI
labels must keep these layers separate.

Promotion requires:

1. pinned source and target provenance;
2. structural reload of the emitted artifact;
3. validator-owned semantic comparison at the required samples;
4. named ecosystem compatibility evidence for `certified`;
5. a manifest entry that binds the evidence to the exact tuple.

Synthetic fixtures may test codecs, limits, or failure handling, but cannot
promote assurance.

## Active gaps

- Add pinned external-consumer evidence for exact humanoid cases that have only
  structural or semantic evidence.
- Keep PMX delivery, generic/market FBX input, and standalone VMD output gated
  until reproducible committed fixtures and matching semantic evidence cover
  their claimed scope. The ignored Gene research corpus is supporting local
  evidence, not a default beta fixture.
- Extend non-humanoid output choices only through a versioned rig definition,
  capability entry, solver route, and generated certification result.

## Maintenance rule

When an export changes, update its registry, adapter, compatibility selector,
tests, and certification manifest. Remove a completed item from this document;
do not append a dated “implemented” section or a second capability matrix.
