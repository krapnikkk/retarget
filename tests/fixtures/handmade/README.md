# Hand-made independent fixtures

These fixtures exist for issue #10. Their bytes were written by tools other than
this library, so tests catch errors that a library-written file would share with
the library's own reader. The first VMD made this way exposed #16.

| Fixture | Writer | Proves |
| --- | --- | --- |
| [`mmd-walk/mmd-walk.vmd`](mmd-walk/README.md) | MMD Tools 4.5.14 VMD exporter | Real MMD units, MMD facing (−Z), A-pose arm rest, standard Japanese bones, FK legs |
| [`mixamo-walk/mixamo-walk.fbx`](mixamo-walk/README.md) | Blender 5.2.1 LTS FBX exporter | `mixamorig:` naming and hierarchy, centimetres (`UnitScaleFactor` 1), embedded texture ("With Skin"), `mixamo.com` take |

Both are built from one CC0 source: the certified Animated GLB of the CC0
Quaternius walk on the CC0 Studio Mannequin. That is the file the pinned Blender
and Godot receipts certify, SHA-256
`171bd29bb8b7b7582876ecdbe2eef2b9c18cecaa1e72b64987c7ed79fd3d3eec`. Regenerate it
with:

```sh
RETARGET_ECOSYSTEM_ARTIFACT_PATH=<dir>/source.animated.glb pnpm exec vitest run tests/certification/generate-ecosystem-artifact.test.ts
```

Then run the Blender scripts in `scripts/fixtures/blender/` (usage in each
script's header). The `.blend` working files are not committed, because the
scripts regenerate them. Exported files embed creation timestamps, so a rebuild
is equivalent but not byte-identical. Tests check structure and motion, not
hashes.

Not covered: the Mixamo fixture does not reproduce real Mixamo downloads'
`PreRotation` node properties. Blender's exporter does not write them.
