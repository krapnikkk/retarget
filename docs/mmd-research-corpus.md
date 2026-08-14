# MMD research corpus

[简体中文](zh-CN/mmd-research-corpus.md)

This local corpus prepares real PMX, PMD, and VMD inputs for MMD format-family
research and conversion tests. The binaries live under the gitignored
`references/mmd/research-corpus/` tree. They are not public catalog inputs and
must not be copied into `assets/`, `public/`, or release bundles without a
separate release review.

## Reproduce or verify

```powershell
pnpm fetch:mmd-research-corpus
pnpm check:mmd-research-corpus
pnpm test:mmd-research-corpus
```

The fetcher pins every source to an immutable commit and verifies file size,
SHA-256, and PMX/PMD/VMD magic bytes. It downloads missing files, refuses to
replace a mismatched local file by default, and writes a local `manifest.json`.
Use `--force` only when intentionally restoring a mismatched corpus file.
The focused test runs the production PMX/PMD conversion and VMD import paths;
the normal test suite skips this corpus test when the gitignored downloads are
not present.

## Corpus inventory

### MMDAgent-EX CG-CA Gene

- Source: <https://github.com/mmdagent-ex/gene>
- Commit: `c7eace43dffaccff6ad0597433ef85fa57c91e03`
- License evidence: the pinned `README.md` states that repository files are
  CC BY 4.0 and provides the required credit. It separately retains trademark
  and design rights and limits their permitted use. Keep this source
  reference-only for academic conversion research unless those separate rights
  are cleared for the intended product use.
- Models: `Gene_light.pmx` and `Gene_light.pmd`, plus all 12 files in `light/`.
- Motions: `00_normal.vmd`, `01_happy.vmd`, `16_thinking.vmd`,
  `22_apology.vmd`, and `stand.vmd`.
- Why it is useful: a matched PMX/PMD pair with the same 224-bone humanoid,
  184 morphs, 13 materials, external textures, physics, and motions from the
  same publisher. The light textures keep the local corpus near 10 MB.

### babylon-mmd parser fixtures

- Source: <https://github.com/noname0310/babylon-mmd>
- Commit: `3f523d392c176d5c9c9f9264f622d0631c1d298e`
- License evidence: pinned repository `LICENSE` (MIT).
- PMX cases: bone flags, hierarchy, constraints, UV morphs, and a textured
  matcap sample with its referenced `ref.jpg`.
- VMD cases: two small physics-toggle fixtures, including one body-track case
  and one unsupported-track-only case.
- Why it is useful: very small, focused files for parser edge cases and
  feature-specific regression tests. Several are intentionally not complete
  humanoid avatars.

### nanoem emapp fixtures

- Source: <https://github.com/hkrn/nanoem>
- Commit: `30acffaa29f5d2eb9e997d69418f2e4b97b5894f`
- License evidence: pinned `LICENSE.md`, `LICENSE.MPL`, and `LICENSE.MIT`.
  `LICENSE.md` assigns the `emapp` component containing these fixtures to MPL;
  treat the selected fixture files as MPL-2.0.
- PMX cases: `emapp/test/fixtures/test.pmx` and
  `emapp/test/fixtures/effects/main.pmx`.
- Why it is useful: independent implementation fixtures with a 140-bone table,
  materials, texture references, and effect-oriented structure. They contain
  zero mesh vertices, so they are parser fixtures rather than avatar previews.

## Current project smoke results (2026-08-13)

The downloaded corpus was exercised through the production parsers, without
changing conversion code:

| Input | Result |
|---|---|
| `Gene_light.pmx` | Converted to one skinned mesh, 226 nodes, 13 primitives, one skin, and 13 resolved textures |
| `Gene_light.pmd` | Converted to one skinned mesh, 226 nodes, 13 primitives, one skin, and 13 resolved textures |
| `01_happy.vmd` | Full document decoded; 50 canonical body/finger tracks, 345 morph frames, 10-second document range |
| `16_thinking.vmd` | Full document decoded; 50 canonical body/finger tracks, 10 seconds |
| `22_apology.vmd` | Full document decoded; 50 canonical body/finger tracks, 10 seconds |
| `stand.vmd` | Full document decoded; 50 canonical body/finger tracks, 4 seconds |
| `00_normal.vmd` | Expected negative fixture: no currently supported body tracks |
| babylon-mmd PMX set | All five selected files parsed; zero-vertex bone fixtures remain parser-only |
| babylon-mmd VMD v2 | Expected negative fixture: unsupported-track-only |
| babylon-mmd VMD v3 | Imported; 8 supported tracks, about 0.67 seconds |
| nanoem PMX set | Both files parsed; zero-vertex fixtures remain parser-only |

The production codec now parses and rewrites all standard VMD sections, and the
native PMX/PMD viewer exercises the three-mmd runtime for morphs, IK, append
transforms, SDEF/QDEF, toon/sphere materials, and Ammo physics. These checks do
not claim that cross-format humanoid retargeting can reproduce MMD camera,
light, audio, MME effects, or model-specific non-humanoid control semantics.

## Deliberately excluded

The Miku/Luka samples in `MMD-Blender/blender_mmd_tools` and the Miku PMD/VMD
examples copied by Three.js-related repositories were not collected. Their own
sample notices identify Piapro-character/non-commercial or other asset-specific
terms, so a repository-level GPL or MIT label must not be treated as licensing
those character binaries for unrestricted use.
