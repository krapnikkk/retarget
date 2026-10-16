# mmd-walk.vmd

A single walk cycle in real MMD units, written by MMD Tools' VMD exporter.

| Item | Value |
| --- | --- |
| Format | VMD `Vocaloid Motion Data 0002`, model name `mmd-walk` |
| Frames | 0–40 at 30 fps (1.333 s), 41 keys per bone |
| Bones (22) | センター 下半身 上半身 上半身2 首 頭, and 肩 腕 ひじ 手首 足 ひざ 足首 つま先 on both sides |
| Legs | FK keys only; no 足ＩＫ |
| Skeleton | Leg roots (左足/右足) at 10 MMD units (0.80 m at 0.08 m/unit); arms in a 34° A-pose, collinear |
| Root | センター travels 13.95 units toward MMD −Z (forward), with vertical bob |
| Export | `mmd_tools.export_vmd(scale=12.5, use_frame_range=True)` |

## Build

```sh
blender --background --factory-startup --python scripts/fixtures/blender/make-mmd-walk.py -- <source.animated.glb> <out-dir> D:\Tools\mmd_tools-v4.5.14
```

The script builds a standard-proportion MMD skeleton from the source mannequin's
rest frames (scale 0.837 for 0.80 m leg roots) and turns the arm chain into the
A-pose. Each bone copies its source bone's world rotation, and センター also
copies the hips position. The result is baked to FK keys and exported. MMD Tools
is loaded from the unpacked release folder for the run only; it is not
installed into the Blender profile. Its bundled `opencc` wheel is extracted to
`site/` there, because opencc reads its data files from disk.

## Expected results

On a VRM 1.0 target, the motion matches the direct glTF path within about 5 cm
for every joint over all 41 frames. See `tests/pipelines/handmade-fixtures.test.ts`.
