# Non-humanoid fixture inventory

[简体中文](README.zh-CN.md)

`mesh2motion/` contains pinned acceptance fixtures from the official
[Mesh2Motion application repository](https://github.com/Mesh2Motion/mesh2motion-app).
The upstream `LICENSE-CC0.MD` states that all 3D models, rigs, and animations are
dedicated under CC0 1.0. The exact upstream commit, source path, and SHA-256 for
every file are recorded in `mesh2motion/provenance.json`.

Run `pnpm fetch:mesh2motion-fixtures` to reproduce the fixture set from the
pinned upstream commit. Run `pnpm check:mesh2motion-fixtures` to verify the
committed files without network access.

These files are test evidence, not public catalog entries. Catalog admission
still requires its own manifest, preview, integrity lock, and certification
record.

| Fixture case | Source | Acceptance |
|---|---|---|
| quadruped action matrix | `fox-animations.glb` | Idle, Walk, Run, and Jump |
| quadruped proportions | `fox-base.glb`, `fox-dog.glb`, `fox-horse.glb` | same-signature and cross-proportion retarget |
| avian | `bird-animations.glb`, `bird-eagle.glb` | wings, legs, and tail |
| serpentine | `snake-animations.glb` | variable axial-chain resampling, including a generated 8-joint target |
| arachnid | `spider-animations.glb` | eight numbered radial limbs and a scaled-rest target |
| dragon/creature | `dragon-animations.glb` | body, four limbs, wings, tail, and a scaled-rest target |
| unrigged boundary | `snake-target.glb`, `spider-target.glb`, `dragon-target.glb` | rejected before solving because a mesh alone is not a rig |
