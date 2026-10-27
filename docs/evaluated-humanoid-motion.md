# Evaluated humanoid motion input

`importHumanoidSkeletalMotion` in `@krapnik/retarget/io` accepts serializable,
evaluated skeletal animation without an FBX or Mixamo intermediate. The owner is
`src/import/skeletal-motion.ts`; existing VRMA and VMD exporters own output formats.
No AssetBundle parser, provider protocol, static Avatar, or Unity runtime is bundled.

```ts
import { importHumanoidSkeletalMotion, exportVRMA, exportVMD } from '@krapnik/retarget/io';

const clip = importHumanoidSkeletalMotion(evaluatedMotion, {
  humanBoneLayout: 'unity-human-trait',
  budget: { maxBones: 256, maxSamplesPerTrack: 100000, maxTotalSamples: 1000000 },
});
const vrma = await exportVRMA(clip);
const vmd = await exportVMD(clip, { disableLegIK: true });
```

Input is right-handed, Y-up, +Z-forward, in metres. Joints are parent-first;
rest and frame transforms are absolute **local** position(3), XYZW rotation(4),
scale(3). Times start at zero and strictly increase. At least two frames and all
required humanoid joints are required. Scales must be approximately one.

The caller must select the numeric semantic layout:

- `unity-human-body-bones`: public HumanBodyBones enum, Neck=9, Head=10,
  LeftThumbProximal=24, UpperChest=54.
- `unity-human-trait`: native skeleton ordering, UpperChest=9, Neck=10, Head=11,
  first thumb=25. Also accepts the legacy UpperChest=55 reference-profile alias,
  rejecting duplicate semantic mappings.

The importer folds animated helper ancestors into semantic joints using world
rest deltas, then emits canonical -Z-forward tracks. Root ancestor translation
and rotation are retained in Hips, with source rest hips height recorded for
target scaling. Missing UpperChest remains absent. First-frame motion and
duration are preserved. Non-root animated translations, animated facial bones,
scaled skeletons, missing required bones and ambiguous mappings fail explicitly.
No contact solver, grounding, smoothing, or target-character proportions apply.

The synchronous input API has no DOM/AbortSignal contract. Hosts should run it
and exporters in a Worker and terminate that Worker to cancel synchronous work.
Input budgets bound allocations before generated tracks are constructed.

VRMA retains source key times using float32 glTF accessors. VMD samples at 30 fps;
the last frame holds the end pose to the next 30-fps boundary. It exports standard
Japanese body/finger bone names, not PMX/PMD meshes, morphs, camera, or physics.
`disableLegIK` writes a frame-zero visible-model property key disabling standard
left/right leg and toe IK names. It does not solve contacts or disable custom
model-specific IK names. The default remains unchanged for existing callers.

Validation: synthetic rest/root/helper, numeric-layout, malformed input, budget,
VRMA/VMD reload and optional IK-property tests. Consumer-specific real bundles
remain outside this library and are not library release gates.

Public enum reference: [Unity HumanBodyBones](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Modules/Animation/ScriptBindings/Avatar.bindings.cs). Native ordering is a separate explicit input contract.
