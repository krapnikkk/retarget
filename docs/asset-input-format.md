# Canonical Asset Input Format (v1)

This v1 document is the canonical **humanoid** contract. Already-rigged
non-humanoid GLBs use a versioned Rig Definition, catalog rig metadata, and Rig
Motion JSON v2 as defined in `docs/non-humanoid-retargeting-plan.md`. Do not add
tails, wings, or animal legs to the v1 humanoid bone list.

This is the controlled input contract for SDK-owned conversion and validation.
Every admitted character and motion fixture must be a **GLB** conforming to this
spec before it enters the canonical pipeline. One input convention means every
export adapter can rely on the same explicit assumptions.

This is not a new file format or a new `AvatarFormatId`/`MotionFormatId` in
the adapter registry. It is a stricter subset of the existing
`gltf-humanoid` / `gltf-animation` import contract, written down so our own
Blender export scripts (and anyone reviewing a submitted asset) have a
single checklist to build and validate against.

**Asset production stays closed for now.** This spec governs our own
private Blender-to-GLB export pipeline; there is no public asset
repository or third-party submission process yet. See
`docs/asset-market-plan.md` for how that may change later.

---

## Why GLB, and why this exact convention

The canonical bone names below are already the VRM 1.0 humanoid bone
names, and they are already this project's internal `HumanoidBoneName`
union (`src/retarget/types.ts`). That is not a coincidence — VRM's
humanoid rig is the strictest, most widely-supported "canonical humanoid"
convention available, and this project already treats it as the pivot
format (`VRM_HUMANOID_PROFILE` in `src/profiles/humanoid.ts` aliases
each bone to itself with no renaming). Exporting to this convention means:

- **Zero bone-name translation** into VRM authoring (M2): a node named
  `leftUpperArm` maps directly onto the VRM humanoid slot of the same
  name.
- **Zero bone-name translation** into GLB/Animated GLB (already active).
- A single, well-known reverse-mapping table (`bone-naming.ts`) gets us to
  Mixamo / ActorCore / BVH-standard / MMD names for FBX, BVH, VMD.

## Required vs. optional bones

All bone names come from `HUMANOID_BONES` in `src/retarget/types.ts`
(55 total). A subset is load-bearing; the solver and every export adapter
degrade gracefully around the rest.

**Required** (must be present and skinned; matches `REQUIRED_VRM_BONES`):

```txt
hips, spine, head,
leftUpperArm, leftLowerArm, leftHand,
rightUpperArm, rightLowerArm, rightHand,
leftUpperLeg, leftLowerLeg, leftFoot,
rightUpperLeg, rightLowerLeg, rightFoot
```

**Recommended** (present in most quality character/motion assets):

```txt
chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes
```

**Optional** (finger bones; include for hand-detail motions, omit
otherwise — omitting all of them is valid and common):

```txt
left/right ThumbMetacarpal, ThumbProximal, ThumbDistal,
IndexProximal, IndexIntermediate, IndexDistal,
MiddleProximal, MiddleIntermediate, MiddleDistal,
RingProximal, RingIntermediate, RingDistal,
LittleProximal, LittleIntermediate, LittleDistal
```

Fingers are all-or-nothing per hand family: if you include any finger
bone, include the full proximal→intermediate→distal chain for that
finger, since the solver propagates finger tracks only when both source
and target expose the complete chain.

## Node naming

Node (bone) names in the exported GLB must be **exactly** the canonical
name (e.g. `leftUpperArm`, not `LeftUpperArm`, `mixamorig:LeftArm`, or
`left_upper_arm`). The generic glTF humanoid profile also accepts an
all-lowercase variant as a fallback, but exact canonical casing is the
target — don't rely on the fallback.

Non-humanoid nodes (root/armature wrapper nodes, mesh nodes) may be named
anything; only humanoid joint nodes are matched by name.

## Skeleton hierarchy

**The actual parent/child node structure in the GLB is what gets used** —
there is no hardcoded "expected" hierarchy the importer checks against.
Concretely this means:

- Build the rig hierarchy however is natural in Blender (typical
  hips → spine → chest → upperChest → {neck → head, leftShoulder → …,
  rightShoulder → …} and hips → {leftUpperLeg → …, rightUpperLeg → …}
  is the reference shape, but not enforced).
- Every humanoid joint must still be reachable from the scene's default
  root and have `updateMatrixWorld` produce a sane world transform (i.e.
  no unresolved/disconnected joints).

## Rest pose

- **T-pose.** Arms extended horizontally, palms facing down (or forward —
  see `restPose: "normalized"` on `VRM_HUMANOID_PROFILE`, matching VRM's
  normalized rest convention).
- `hips` world-space Y position at rest is used elsewhere in the pipeline
  as the reference height for scale normalization — make sure the
  character stands at its true rest height at the origin, not offset.

## Axes, units, scale

| Property | Value |
|---|---|
| Up axis | +Y |
| Forward axis | −Z (glTF convention) |
| Units | 1 unit = 1 meter |
| Scale | Character at real-world height in meters (e.g. ~1.7 for an adult human); no arbitrary rig scale factors baked into node transforms |

This matches `VRM_HUMANOID_PROFILE` (`upAxis: "y"`, `forwardAxis: "-z"`,
`scaleUnit: "meters"`) exactly, which is intentional: exporting straight
from Blender's glTF exporter with default axis conversion (+Y up) already
produces this.

## Mesh and skinning

- One or more meshes, one or more primitives per mesh (split by material
  is fine and expected).
- Triangulated (`POSITION`, `NORMAL`, `TEXCOORD_0` required per
  primitive).
- Skinned primitives must carry `JOINTS_0` / `WEIGHTS_0` with **at most 4
  bone influences per vertex** and weights normalized to sum to 1. This
  is a hard ceiling: both the FBX cluster writer and the PMX weight
  format cap at 4 influences (BDEF4-equivalent), so anything beyond 4
  gets silently truncated downstream — don't rely on 5+ influence
  skinning in Blender.
- Every skinned mesh needs a `Skin` with `inverseBindMatrices` (Blender's
  glTF exporter produces this automatically for armature-parented
  meshes).

## Materials and textures

- `baseColorFactor` and/or a `baseColorTexture` per material.
  `baseColorTexture` should be **embedded** in the GLB (not
  external-file reference) — PNG or JPEG.
- Only base color is guaranteed to survive every export target today
  (FBX embeds it as a `Video`/`Texture` node; VRM/PMX authoring will need
  to decide their own material mapping in M2/M3). Don't depend on
  metallic/roughness, normal maps, or emissive surviving non-GLB exports
  yet.

## Motion assets specifically

- Export as an animation-only GLB (no mesh) targeting the same canonical
  joint names, sampled at **30 FPS**.
- `hips` must carry both a rotation and a translation track (root motion);
  every other bone needs at most a rotation track.
- Keep the clip a single, seamless animation (idle/walk/run/etc. as
  separate files) — the pipeline has no clip-splitting step.

## Metadata

Bake into custom properties on the Blender file / carry through the
export script as sidecar JSON, not into the GLB binary itself:

```json
{
  "name": "walk-01",
  "kind": "motion",           // or "character"
  "author": "…",
  "license": "CC-BY-4.0",     // required; public values: CC0-1.0 or CC-BY-4.0
  "sourceUrl": "https://…",   // required for CC-BY-4.0; recommended for third-party CC0
  "sourceBlendFile": "walk-01.blend",
  "notes": "…",
  "published": true,           // required explicit release decision
  "loop": true,                // required boolean for motion assets only
  "rigFamily": "humanoid",    // legacy omission defaults to humanoid
  "rigDefinitionId": "humanoid-v1",
  "rigProfileId": "canonical-humanoid-v1"
}
```

The catalog pipeline now reads this schema from `meta.json` beside each
source GLB. `license` is mandatory. A published asset must use the canonical
identifier `CC0-1.0` or `CC-BY-4.0`; unknown/custom licenses are rejected.
Corpus metadata must preserve the source URL, SHA-256, license, author when
required, and redistribution classification. Product publication policy is a
consumer responsibility and is not part of this SDK input contract.
New non-humanoid fixtures must explicitly declare rig family, definition, and
profile. Admission verifies that the definition belongs to the family, the
profile belongs to the definition, and the GLB maps every required role.

## Validation checklist

Before an exported GLB is considered pipeline-ready:

- [ ] All 15 required bones present, named exactly, skinned (character
      assets) or animated (motion assets)
- [ ] No bone name outside the `HUMANOID_BONES` list on a joint node
      intended to be recognized as humanoid
- [ ] T-pose rest pose, real-world meter scale, +Y up / −Z forward
- [ ] ≤4 joint influences per vertex, weights sum to 1
- [ ] `baseColorTexture` embedded, not external
- [ ] Loads cleanly through the project's own import path:
      `loadCanonicalAvatarRig` (character) reports zero
      `missingRequiredBones`, or the motion importer for `gltf-animation`
      parses without missing-track warnings

Run `pnpm validate-asset <file.glb> --kind character|motion` to automate
the hard checks above before a GLB reaches the conversion step. The rest
pose and meter-scale checks are best-effort warnings; review them
manually.

For a quadruped source, pass its full semantic contract, for example:

```powershell
pnpm validate-asset .\dog.glb --kind character --rig-family quadruped --rig-definition quadruped-v1 --rig-profile canonical-quadruped-v1
```

## Versioning

This is **v1**. If the convention changes (e.g. required-bone set,
scale convention), bump the version and note what changed here — assets
already in the pipeline are versioned against the spec revision they were
exported under, so a convention change doesn't silently invalidate
existing exports.
