# mesh2motion-app Analysis

[简体中文](../zh-CN/research/mesh2motion-app-analysis.md)

## Overview

`references/mesh2motion-app` is an open-source browser tool for applying skeletons and animations to 3D models. Its product shape is similar to Mixamo, but it is more extensible: it supports multiple built-in rig families and includes an experimental animation retargeting flow.

The main user flow is:

```txt
Upload 3D model
-> choose skeleton type
-> edit skeleton placement
-> calculate skin weights
-> preview animation library
-> export GLB/GLTF
```

The project also has a separate retargeting mode for applying animation between existing rigged models.

## Technology Stack

- Vite
- TypeScript
- Three.js
- Vitest
- Cloudflare Wrangler
- JSZip
- file-saver
- tippy.js

Important files:

- `references/mesh2motion-app/package.json`
- `references/mesh2motion-app/vite.config.js`
- `references/mesh2motion-app/src/Mesh2MotionEngine.ts`
- `references/mesh2motion-app/src/RigConfig.ts`
- `references/mesh2motion-app/src/retarget/AnimationRetargetService.ts`

Vite has three page entries:

- `src/index.html`: explore/marketing preview.
- `src/create.html`: main custom model workflow.
- `src/retarget/index.html`: experimental rigged-model retarget workflow.

## Main Architecture

The central runtime class is `Mesh2MotionEngine`. It owns the Three.js scene, camera, renderer, transform controls, event listeners, UI references, and workflow steps.

The main workflow is split into step classes:

- `StepLoadModel`: loads user models, including GLB/GLTF/FBX and ZIP-packaged model assets.
- `StepLoadSkeleton`: loads a selected preset rig.
- `StepEditSkeleton`: supports skeleton editing, mirroring, undo/redo, transform controls, and drag-based bone placement.
- `StepWeightSkin`: generates skinned meshes and skin index/weight attributes.
- `StepAnimationsListing`: loads animation libraries, previews clips, supports filtering and export selection.
- `StepExportToFile`: exports selected skinned meshes and clips through Three.js `GLTFExporter`.

This gives the app a clear staged pipeline, but the implementation is still tightly coupled to DOM state, Three.js scene state, and singleton-like UI managers.

## Supported Rig Families

Rig configuration is centralized in `RigConfig.ts`. Supported skeleton types are:

- Human
- Fox
- Bird
- Dragon
- Kaiju
- Spider
- Snake
- Fish

Each rig config defines:

- default model file
- rig/skeleton GLB file
- display name
- animation files
- animation preview folder
- skeleton reference image
- position tracking bone
- optional model variations

The `static` directory contains a large asset library: models, rigs, animation GLBs, animation preview MP4s, reference images, icons, and test files. This project is therefore both codebase and bundled asset library.

## Automatic Skinning

The automatic skinning pipeline is heuristic, not ML-based.

Core classes:

- `SkinningAlgorithm`
- `WeightCalculator`
- `WeightSmoother`
- `WeightNormalizer`
- `HeadWeightCorrector`
- `BoneClassifier`

The pipeline:

```txt
bone hierarchy + mesh geometry
-> initial vertex-to-bone weight assignment
-> category-aware boundary smoothing
-> weight normalization
-> optional head weight correction
-> SkinnedMesh creation
```

`WeightSmoother` uses different smoothing behavior for torso, limbs, and other boundaries. This is important because generic 50/50 blending at every boundary produces poor deformation around elbows, knees, hips, and torso transitions.

## Retarget Module

The retarget module is separate from the main auto-skinning workflow.

Core files:

- `src/retarget/retarget.ts`
- `src/retarget/AnimationRetargetService.ts`
- `src/retarget/steps/StepLoadSourceSkeleton.ts`
- `src/retarget/steps/StepLoadTargetModel.ts`
- `src/retarget/steps/StepBoneMapping.ts`
- `src/retarget/steps/StepExportRetargetedAnimations.ts`
- `src/retarget/bone-automap/BoneAutoMapper.ts`
- `src/retarget/human-retargeting/Retargeter.ts`
- `src/retarget/human-retargeting/HumanChainConfig.ts`

The retarget workflow is:

```txt
load source skeleton
-> load target rigged model
-> map source bones to target bones
-> retarget selected animations
-> export retargeted clips
```

Bone mapping supports:

- direct Mixamo mapping
- direct Rigify mapping
- Mesh2Motion mapping
- custom drag/drop mapping
- category/name-based auto mapping

## Swing/Twist Human Retargeting

The most technically useful part for a general retargeting product is the human swing/twist retargeter.

Its idea is not just to rename animation tracks. Instead, it builds source and target rigs, evaluates the source animation, and computes target bone rotations that align anatomical directions.

The core idea:

```txt
source world rotation
-> extract source swing direction and twist direction
-> compute target neutral transform from current pose and T-pose
-> rotate target swing direction toward source swing
-> rotate target twist direction toward source twist
-> convert result back into target local space
-> write to target pose
```

Special handling:

- pelvis/root motion uses scaled translation
- spine can use end interpolation
- incomplete chains fall back to simpler per-chain behavior
- baked output is written as Three.js keyframe tracks

This is closer to true skeleton-to-skeleton retargeting than a simple bone-name remap.

## Testing State

The test surface is narrow. Existing test documentation says current tests focus mostly on retargeting bone category mapping.

Covered:

- torso bone mapping
- arm bone mapping
- hand bone mapping
- leg bone mapping
- wing/tail/unknown categories
- edge cases around empty arrays, case sensitivity, and special characters

Weakly covered or uncovered:

- model import edge cases
- automatic skinning quality
- GLB export correctness
- full browser workflow
- animation retarget quality
- Three.js scene lifecycle

## Strengths

- Clear staged workflow.
- Good centralized rig configuration.
- Large built-in rig and animation asset library.
- Practical browser-first GLB export flow.
- Useful automatic skinning heuristics.
- Real retargeting concepts beyond simple track renaming.
- Several reusable pieces for future retarget systems, especially bone auto-mapping and swing/twist human retargeting.

## Weaknesses

- Tight coupling between UI, DOM, Three.js scene state, and process classes.
- Limited tests relative to algorithmic complexity.
- Asset-heavy repository.
- Retarget module is marked experimental in product behavior.
- Export and retarget behavior are likely sensitive to skeleton naming, pose assumptions, and model scale.
- The generality of non-human rigs is stronger in the auto-skinning workflow than in the retarget workflow.

## Relevance To 3dretarget-online

Useful ideas to borrow:

- staged workflow design
- centralized rig configuration
- bone auto-mapping strategy
- skeleton chain configs
- swing/twist retarget solver
- GLB export pipeline
- animation preview library model

Ideas to avoid copying directly:

- large DOM-bound process classes
- broad asset bundling before product validation
- trying to solve auto-rigging, skinning, retargeting, preview, and export in one MVP

For the current `3dretarget-online` direction, `mesh2motion-app` is best treated as a technical reference for future general retargeting. It is not a direct product template for the current VRM/Mixamo MVP.
