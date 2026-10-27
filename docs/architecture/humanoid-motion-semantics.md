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
  as `metadata.rootMotionEvidence.scaleSource`. The preset is the hips joint at
  leg-root (`左足`) height, matching canonical `restHipsHeight` for other
  formats; measured leg roots are 10.48 (MMDAgent-EX Gene) and 10.75 (nanoem
  emapp `test.pmx`), so it is about 5–7% low for those models. VMD import and
  export share the one constant.
- MMD (PMX/PMD) targets map `hips` to `センター`, which sits below the leg
  roots, so their rest hips height is the average `左足`/`右足` height while
  root motion is still driven on `センター`. VMD bound to an MMD target keeps
  its root motion unscaled, as MMD itself plays it; other sources scale to the
  leg-root height.
- MMD models face -Z in MMD's left-handed space with their left side at +X.
  VMD import mirrors into right-handed space (MMD forward becomes +Z), then
  turns into the canonical -Z-forward basis; VMD export is the exact inverse.
  VMD rotations are relative to the MMD model's A-pose rest, so arm chains are
  rebased by `MMD_STANDARD_ARM_REST_DEGREES` (34°, measured on MMDAgent-EX
  Gene): the upper arm takes the rest offset, forearm/hand/fingers are
  conjugated by it.
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

## Target-bound pose corrections (0.10.0)

`bakeHumanoidPoseEdits` and the cancellable `pose-humanoid` Worker job accept an uncorrected, target-bound solved clip. The order is canonical clip edit, mapping/solve/Foot Cleanup, FK corrections in list order, then two-bone IK in list order, and target binding for preview/export. Never solve or bake the output again. Keep the original canonical and uncorrected solved clips for undo and comparison.

Pose edit v1 binds to the exact `humanoid-rest-v1` signature and rest-pose version 1. A different target must suspend corrections until explicit rebinding or clearing. Maximum 16 corrections; all values are finite. Each correction has enabled, weight [0,1], start/end and fades. Interior interval boundaries require positive fades; outside the interval and at zero weight the original animation is preserved. Baking samples the existing key times plus clip-FPS samples and fade boundaries, subject to caller processing budgets. Between baked samples playback uses SLERP; IK endpoint accuracy is guaranteed at baked samples, with interpolation approximation between them.

FK appends an XYZ Euler rotation in degrees [-180,180] to the mapped joint's current local rotation. The SDK converts it back to canonical deltas using actual target rest axes. IK targets/poles use target world coordinates in the avatar's native units, after root motion. `sampleHumanoidTargetPose` supplies those positions. Hand/foot IK requires contiguous mapped upper/lower/end joints and nonzero lengths. It preserves segment lengths; unreachable points clamp to reach and report IK_UNREACHABLE. Degenerate poles leave that sample unchanged and report IK_POLE_DEGENERATE. Opposing bend direction reports IK_BEND_FLIP. FK remains available on scaled rigs; IK rejects known non-uniform/reflected scales from avatar inspection. Direct API callers must provide rigid, uniformly scaled chains. The retained rest signature rounds transforms to 1e-5 units.

The output carries settings, bounded warnings and a reproducible result ID in metadata.poseEdit. VRMA retains baked canonical rotations and must be used with the same avatar to reproduce target-world goals; it does not embed an enforceable rig lock for third-party players. Motion JSON preserves metadata. Bound animated GLB and baked VRM preserve the actual target. Standalone glTF/BVH/FBX, animated FBX and PMX/VMD are disabled for corrected clips until their target-specific semantics have dedicated evidence. Structural and semantic reload checks do not promote ecosystem certification. No mirror or pose preset is inferred from bone names.
