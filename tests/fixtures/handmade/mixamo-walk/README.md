# mixamo-walk.fbx

A skinned, textured walk with a Mixamo-structured skeleton, written by Blender's
built-in FBX exporter. It corresponds to a Mixamo "With Skin" download.

| Item | Value |
| --- | --- |
| Format | Binary FBX 7400 |
| Units | Centimetres: `UnitScaleFactor` 1, values in cm; character 1.87 m |
| Facing | +Z (Y up); walks toward +Z |
| Skeleton | 65 bones, all `mixamorig:`, rooted at `mixamorig:Hips`; Spine/Spine1/Spine2, HeadTop_End, Toe_End, five fingers ×4 per hand |
| Rest pose | T-pose |
| Mesh | CC0 Studio Mannequin body, ≤ 4 influences per vertex, normalized |
| Texture | 64×64 PNG checker embedded as a `Video` node, wired to both materials |
| Animation | Take `mixamo.com`, frames 0–40 at 30 fps (1.333 s) |

## Build

```sh
blender --background --factory-startup --python scripts/fixtures/blender/make-mixamo-walk.py -- <source.animated.glb> <out-dir>
```

The mannequin already rests in a T-pose, so the script renames its skeleton to
Mixamo names, makes `mixamorig:Hips` the root, and adds `HeadTop_End`. It then
converts to centimetres: scene unit scale 0.01, scale applied, and hips
location keys scaled ×100. It embeds the texture and exports with
`apply_scale_options="FBX_SCALE_NONE"`, `path_mode="COPY"`,
`embed_textures=True`, `add_leaf_bones=False`, and the scene frame range set to
the action. Blender writes each bone's `Lcl` transform from the current frame's
pose, so the script keys the T-pose one frame before the cycle and exports from
that frame. Like real Mixamo files, `Lcl` then holds the rest pose that readers
take as rest.

## Known differences from real Mixamo downloads

- No `PreRotation` node properties; Blender's exporter does not write them.
- Blender converts axes with a −90° X rotation on the root node; Mixamo files
  have none. The world-space result is the same.
