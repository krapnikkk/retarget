# Humanoid motion semantics

[简体中文](../zh-CN/architecture/humanoid-motion-semantics.md)

The humanoid pipeline has four explicit semantic stages. Format adapters may
parse source data, but they must not label raw source-local values as canonical
motion.

```text
RawImportedHumanoidMotion
  -> Source normalization
CanonicalMotion
  -> Target-aware solve
SolvedHumanoidMotionClip
  -> Verified target binding
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
- Canonical motion is targetless and deterministic. `sourceCanonicalId` is the
  SHA-256 identity of stable semantic content; wall-clock time, random artifact
  ids, processing evidence, and target bindings do not participate.
- Persisted artifact identity belongs in `MotionArtifactEnvelope`, whose
  `artifactId`, canonical ISO `createdAt`, and `toolVersion` are explicit caller
  inputs around the canonical motion.

For glTF and parsed FBX sources, normalization reads each mapped bone's source
rest transform. An absolute local sample becomes a rest-relative world delta
before axis conversion. Sources whose motion is already delta-based skip that
step.

## Target contract

The loaded target profile, available humanoid bones, skeleton tree, full rig
signature, and rest
hips height enter the solver before automatic or manual mapping. Mapping is
therefore constrained by the real target rather than diagnostics created at
source-import time. A solved clip records that full signature as
`processing.targetRigRevision`; only the subsequent binding stage adds the
public `target` object.

The shared target binder converts canonical world deltas into the target axis
basis and parent-local rest basis. Generic avatar preview, document-based
GLB/VRM/FBX export, streamed GLB export, and PMX bone-morph export use these
shared transforms. Node animation outputs are absolute target-local values;
PMX bone morphs receive target-local delta values as required by that format.

Structural export validation remains separate from semantic certification.
No format triple becomes certified until the Golden Motion manifest and
world-space comparisons in the next hardening stage pass.

## Single-clip editing v1

Root API `editHumanoidMotion(original, edit, processingBudget?)` and browser Worker
`runRetargetJob({ type: "edit-humanoid", motion: original, edit }, { signal, deadlineMs, budget: { processing: processingBudget } })`
accept `HumanoidClipEdit`: `{ schemaVersion: 1, startSeconds, endSeconds, speed }`.
Always rebuild from the retained original canonical clip, before mapping, solve and foot cleanup.
One contiguous interval and positive constant speed are supported. Times are rebased to zero;
output duration is `(endSeconds - startSeconds) / speed`. Boundary translation uses linear
interpolation and rotation uses shortest-path SLERP. Spatial root offsets and source FPS remain
unchanged. No keyframe rounding, spatial recentering, or preview playback rate enters this operation.

The result is a new canonical clip with deterministic identity and `metadata.clipEdit`
recording the parent canonical identity and edit settings. The input is never mutated.
Invalid ranges, versions and non-finite numbers raise `PROCESSING_OPTION_INVALID`;
duration, frame, sample and value budgets are checked before allocating output tracks.
The Worker can be terminated by cancellation or the caller-owned deadline; a superseded result
must not replace a newer consumer revision. Editing does not grant ecosystem certification.

The browser bindMotionClipToAvatar helper accepts optional jobOptions containing budget and deadlineMs,
forwarded to avatar inspection and target solve. Consumers can share their editing budgets
with these stages instead of leaving target solve unbounded.
