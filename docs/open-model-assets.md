# Open Model Assets

[简体中文](zh-CN/open-model-assets.md)

Local files were collected under `references/open-models/`. The `references/`
directory is ignored by git, so these assets are intended for local manual
testing, import/export checks, and fixture exploration rather than repository
distribution.

## License Rules

- CC0 / public domain assets can be used without attribution.
- CC BY 4.0 assets can be used, modified, commercially redistributed, and
  sold, but user-facing demos, published screenshots, videos, and redistributed
  bundles must retain attribution and a license link.
- Free-to-use assets with custom licenses are acceptable for local testing, but
  review the linked license before redistributing the original model or motion
  file.
- Keep each downloaded `*.README.md` next to the source file when moving assets.

## Khronos glTF Sample Models

Source: https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0

| File | License | Format | Use |
| --- | --- | --- | --- |
| `references/open-models/khronos-gltf-sample-models/SimpleSkin.gltf` | CC0 / public domain | glTF | Minimal skinning fixture for skeleton and joint handling. |
| `references/open-models/khronos-gltf-sample-models/SimpleMorph.gltf` | CC0 / public domain | glTF | Minimal morph target fixture. |
| `references/open-models/khronos-gltf-sample-models/AnimatedMorphSphere.glb` | CC0 / public domain | GLB | Morph animation import and playback check. |
| `references/open-models/khronos-gltf-sample-models/InterpolationTest.glb` | CC0 / public domain | GLB | Animation interpolation compatibility check. |
| `references/open-models/khronos-gltf-sample-models/CesiumMan.glb` | CC BY 4.0 | GLB | Humanoid animated character sample. Also review Cesium trademark terms before public demos. |
| `references/open-models/khronos-gltf-sample-models/RiggedFigure.glb` | CC BY 4.0 | GLB | Simple rigged figure sample for skeleton import checks. |
| `references/open-models/khronos-gltf-sample-models/RiggedSimple.glb` | CC BY 4.0 | GLB | Small rigged sample for fast skeleton import checks. |
| `references/open-models/khronos-gltf-sample-models/Fox.glb` | Mixed: model CC0, rigging/animation CC BY 4.0 | GLB | Animated rigging sample with multiple clips. Not humanoid, but useful for animation playback. |

Attribution notes from downloaded README files:

- CesiumMan: Donated by Cesium for glTF testing. Licensed under Creative Commons Attribution 4.0 International.
- RiggedFigure / RiggedSimple: Donated by Cesium for glTF testing. Licensed under Creative Commons Attribution 4.0 International.
- Fox: Low poly fox by PixelMannen is CC0; rigging and animation by @tomkranis on Sketchfab is CC BY 4.0; glTF conversion by @AsoboStudio and @scurest.

## Poly Haven

Source: https://polyhaven.com/a/wooden_table_02

Poly Haven assets are published as CC0. The table is not a humanoid asset, but
it provides small FBX and glTF files for loader smoke tests and material/texture
path validation.

| File | License | Format | Use |
| --- | --- | --- | --- |
| `references/open-models/polyhaven-wooden-table-02/gltf/wooden_table_02_1k.gltf` | CC0 | glTF | Textured glTF loader test. |
| `references/open-models/polyhaven-wooden-table-02/fbx/wooden_table_02_1k.fbx` | CC0 | FBX | Generic FBX loader smoke test. |

The glTF file depends on:

- `references/open-models/polyhaven-wooden-table-02/gltf/wooden_table_02.bin`
- `references/open-models/polyhaven-wooden-table-02/gltf/textures/wooden_table_02_diff_1k.jpg`
- `references/open-models/polyhaven-wooden-table-02/gltf/textures/wooden_table_02_nor_gl_1k.jpg`
- `references/open-models/polyhaven-wooden-table-02/gltf/textures/wooden_table_02_arm_1k.jpg`

## VRM Samples

Source: https://github.com/madjin/vrm-samples

| File | License | Format | Use |
| --- | --- | --- | --- |
| `references/open-models/madjin-vrm-samples/vroid/fem_vroid.vrm` | VRoid sample README states CC0 for the relevant sample-model group | VRM | Female VRM avatar import and retarget target test. |
| `references/open-models/madjin-vrm-samples/vroid/masc_vroid.vrm` | VRoid sample README states CC0 for the relevant sample-model group | VRM | Male VRM avatar import and retarget target test. |
| `references/open-models/madjin-vrm-samples/Seed-san/vrm/Seed-san.vrm` | VRM Public License 1.0 | VRM | Free-to-use VRM avatar with VRM-specific license terms. |

License notes:

- Keep `references/open-models/madjin-vrm-samples/README.md` with the VRoid
  samples. It links to the official VRoid Studio sample model terms and
  distinguishes CC0 models from models with particular conditions of use.
- Keep `references/open-models/madjin-vrm-samples/Seed-san/README.md` with
  Seed-san. It identifies the model as Seed-san by VirtualCast, Inc. under VRM
  Public License 1.0.

## MMD PMX / VMD

Source: https://github.com/mmdagent-ex/gene

| File | License | Format | Use |
| --- | --- | --- | --- |
| `references/mmd/research-corpus/mmdagent-gene/Gene_light.pmx` | CC BY 4.0 plus trademark/design usage notes | PMX | Lightweight MMD avatar model for PMX import testing. |
| `references/mmd/research-corpus/mmdagent-gene/motion/00_normal.vmd` | CC BY 4.0 plus repository usage guidelines | VMD | Small facial/dialogue motion fixture. |
| `references/mmd/research-corpus/mmdagent-gene/motion/stand.vmd` | CC BY 4.0 plus repository usage guidelines | VMD | Basic standing motion fixture. |

The lightweight PMX depends on the PNG files in
`references/mmd/research-corpus/mmdagent-gene/light/`. Materialize and verify
this commit-pinned corpus with `pnpm fetch:mmd-research-corpus` and
`pnpm check:mmd-research-corpus`; no second local copy is maintained.

Attribution requested by the Gene README:

```text
CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society
```

The README also notes that the copyright holder keeps trademark and design
rights. Academic and personal non-commercial trademark/design use is permitted;
other commercial use should contact the maintainers.

## BVH Motion

Source: https://github.com/una-dinosauria/cmu-mocap

| File | License / use terms | Format | Use |
| --- | --- | --- | --- |
| `references/open-models/cmu-mocap-bvh/01_14.bvh` | CMU places no restrictions on original data; Bruce Hahne places no additional restrictions on the BVH conversion | BVH | MotionBuilder-friendly CMU BVH sample with T-pose first frame. |

Keep `references/open-models/cmu-mocap-bvh/READMEFIRST.txt` with the BVH file.
It includes the CMU attribution request and conversion notes. The relevant use
rights section says the original data is free for research and commercial
projects worldwide, and the BVH conversion adds no extra restrictions.

## Mixamo

Mixamo assets are free to use through Adobe/Mixamo, but they are not CC0,
CC BY 4.0, or open model assets. Do not download Mixamo files from random GitHub
mirrors unless that mirror has an independent redistribution license from the
rights holder.

Recommended local workflow:

1. Sign in to https://www.mixamo.com/.
2. Download a small character or animation as FBX for local manual testing.
3. Store it under `references/open-models/mixamo-local/`.
4. Do not commit or redistribute the raw Mixamo FBX file unless Adobe's current
   terms explicitly allow that use.

## Format Coverage

Collected:

- GLB / glTF animated, skinned, morph, interpolation, and rigged samples.
- FBX loader smoke-test sample.
- VRM avatar samples.
- PMX avatar model plus VMD motion samples.
- BVH humanoid motion sample.

Not collected:

- VRMA: no clearly licensed small VRMA sample was added in this pass.
- Mixamo FBX: free to use through Adobe/Mixamo, but not collected because raw
  asset redistribution terms are not open-model-style.
