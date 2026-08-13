# Humanoid motion semantics

The humanoid pipeline has three explicit semantic stages. Format adapters may
parse source data, but they must not label raw source-local values as canonical
motion.

```text
RawImportedHumanoidMotion
  -> Source normalization
CanonicalMotion
  -> Target rig mapping and binding
Target-local animation
```

## Canonical contract

- Rotation tracks are rest-relative world-space deltas expressed in the VRM
  humanoid axis basis. Quaternions are normalized and hemisphere-continuous.
- Hips translation tracks are rest-relative world-space offsets. They are in
  meters when the source profile has a known unit scale.
- A source with unknown units is marked `offset-source-units`. Its hips track
  is retained for inspection, but target binding omits it unless a source rest
  height provides scale evidence. This avoids silently treating MMD or
  arbitrary BVH units as meters.
- BVH derives that scale evidence from the hierarchy offsets between Hips and
  the lowest mapped foot/toe joint. VMD has no model skeleton, so it uses an
  explicit 10-unit standard-model rest-hips preset and records that assumption
  as `metadata.rootMotionEvidence.scaleSource`.
- Canonical hips translations are always root-relative offsets after source
  normalization. `metadata.rootTranslationOrigin` prevents target binding from
  subtracting the source rest height a second time.
- glTF `STEP` and `CUBICSPLINE` tracks and VMD bone Bezier curves are evaluated
  with their source interpolation and resampled to bounded linear tracks.
  `metadata.resampledTracks` records the affected track count.
- `metadata.normalizationVersion` distinguishes normalized tracks from legacy
  clips so profile overrides cannot transform the same values twice.

For glTF and parsed FBX sources, normalization reads each mapped bone's source
rest transform. An absolute local sample becomes a rest-relative world delta
before axis conversion. Sources whose motion is already delta-based skip that
step.

## Target contract

The loaded target profile, available humanoid bones, skeleton tree, and rest
hips height enter the solver before automatic or manual mapping. Mapping is
therefore constrained by the real target rather than diagnostics created at
source-import time.

The shared target binder converts canonical world deltas into the target axis
basis and parent-local rest basis. Generic avatar preview, document-based
GLB/VRM/FBX export, streamed GLB export, and PMX bone-morph export use these
shared transforms. Node animation outputs are absolute target-local values;
PMX bone morphs receive target-local delta values as required by that format.

Structural export validation remains separate from semantic certification.
No format triple becomes certified until the Golden Motion manifest and
world-space comparisons in the next hardening stage pass.
