# MMD format-family compatibility

[简体中文](zh-CN/mmd-format-family-compatibility.md)

Status snapshot: 2026-08-13.

This document is the implementation contract for PMX, PMD, and VMD. It keeps
native MMD playback separate from cross-ecosystem humanoid conversion: a valid
MMD document can contain more semantics than a VRM, FBX, BVH, or glTF humanoid
target can represent.

## Reference boundary

- [`moeru-ai/three-mmd`](https://github.com/moeru-ai/three-mmd), commit
  `f93c6486ece84ed90e305c529ba4996fd1368c57`, is the MIT-licensed runtime used
  by the MMD Viewer. The project depends on published version `0.1.1` and loads
  it only when a PMX/PMD asset is previewed.
- [`noname0310/babylon-mmd`](https://github.com/noname0310/babylon-mmd), commit
  `3f523d392c176d5c9c9f9264f622d0631c1d298e`, is an MIT-licensed semantic and
  fixture reference. Its PMX/PMD and VMD behavior is reached indirectly through
  the parser lineage in three-mmd; this project does not add Babylon.js to the
  Three.js preview surface.
- The implementation remains project-owned glue and conversion code. Reference
  repositories define behavior and test cases; their source is not copied into
  project modules.

## Capability matrix

| Capability | Native MMD Viewer | Cross-format conversion | Delivery / round trip |
|---|---|---|---|
| PMX mesh and BDEF/SDEF/QDEF skinning | Native three-mmd | GLB fallback keeps four-weight skinning; SDEF/QDEF are approximated by glTF weights | Original PMX bytes are retained in paired ZIP |
| PMD mesh and BDEF2 skinning | Native three-mmd PMD reader | GLB fallback keeps two-weight skinning | Original PMD bytes are retained in paired ZIP |
| Toon, sphere, edge, diffuse/specular/ambient material data | Native material runtime | Base texture and PBR approximation; MMD-only fields remain in glTF extras | All texture sidecars and relative paths are retained |
| Bone flags, local/fixed axes, append/grant, IK | Native runtime | Parsed into bone metadata; humanoid target uses canonical mapped bones | Original model sections remain byte-for-byte |
| Rigid bodies, joints, Ammo physics | Native runtime | Not representable in generic humanoid motion | Original physics sections remain byte-for-byte |
| Vertex, bone, group, UV, material, flip, impulse morphs | Native runtime | Not flattened into humanoid body tracks | Original morph sections remain byte-for-byte |
| VMD bone interpolation | Native cubic Bezier | Baked at 30 FPS before canonical retargeting | Export writes conventional MMD interpolation bytes |
| VMD morph tracks | Native playback on matching PMX/PMD | Counted and preserved in the document model, not mapped to humanoid body roles | Full codec round trip |
| VMD camera, light, self-shadow, visibility, IK property sections | Fully parsed and rewritten | Reported in metadata, not applied to humanoid targets | Full codec round trip |
| VMD-only inspection | Studio Mannequin canonical fallback | Body/finger layer is visible without a model | Accepted by the MMD Viewer primary picker |
| PMX/PMD + VMD package | Native model and motion preview | Optional humanoid conversion | ZIP preserves every original entry and adds a collision-safe `motion/` file |

## Deliberate boundaries

- The MMD Viewer does not currently animate a VMD camera, light, audio track,
  self-shadow mode, or MME effect. Those sections are decoded without being
  misrepresented as humanoid animation.
- IK controller bones have no model-independent humanoid equivalent. They are
  solved in native PMX/PMD playback; a motion-only VMD conversion reports them
  as unmapped instead of pretending they are FK body tracks.
- `animated-pmx` is an experimental pose-morph sequence, not a PMX animation
  timeline. It is removed from the normal export picker. Its retained adapter
  now appends bone morphs without replacing existing morph, display, rigid-body,
  joint, or soft-body sections. Standard MMD delivery remains original model
  resources plus VMD in a ZIP.

## Verification

```powershell
pnpm check:mmd-research-corpus
pnpm test:mmd-research-corpus
pnpm test
pnpm typecheck
pnpm build
```

The research corpus is immutable and gitignored. Its source, commit, license,
hash, size, and format magic are recorded in `docs/mmd-research-corpus.md` and
the generated local manifest.
