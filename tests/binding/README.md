# Humanoid binding evidence

Both cases in `manifest.json` derive from the existing, SHA-256 pinned Quaternius
CC0 mannequin. The original `SOURCE.txt` and `LICENSE.txt` remain beside that
asset. No downloaded corpus or model weights are added to the package.

`fixtures.ts` removes skins, JOINTS/WEIGHTS attributes, animations and orphaned
accessors. The bare case also removes the old skeleton after preserving mesh
world transforms. The existing-rig case retains the unweighted original nodes
and supplies their explicit humanoid roles and world bind transforms. Export
adds a canonical skeleton and leaves the original nodes intact; consumers must
use the joints referenced by the actual skin, not the first same-named node.

Artist joint centres are supplied as editable anatomical landmarks for the bare
case. Original artist weights are held out from the solver and used only by the
quality oracle. This measures skinning with known joints; it is not a benchmark
of unconstrained automatic joint localization. Marker-free fitting is covered
as an experimental draft, not certified placement quality.

The A-pose regression rotates the source artist upper arms by 0.55 radians,
bakes positions/normals and updates inverse binds before removing the source
skin. Its derived reference is used only for quality comparison; this additional
case has not received the two pinned external-runtime receipts.

## Independent evidence

- Production reload validation compares every vertex at rest and at fixed
  shoulder, elbow, hip and knee rotations. Its quaternion rest-to-pose oracle
  does not call the writer, joint-local conversion or weight solver.
- `quality.ts` compares generated deformation against held-out artist weights
  at the same world rotations. Per-pose RMS/height <= 0.03, P95/height <= 0.08,
  max/height <= 0.20. These declared bounds are specific to this mannequin and
  pose set. They are not a perceptual score or proof of twist/volume preservation.
- A deliberately bad, fully normalized all-hips skin must fail the quality
  gate. Tests separately cover constraints, stale edits, geometry preservation,
  malformed inputs and edited-rig invalidation of previously solved motion.
- `ecosystem.test.ts` binds the pinned walk motion to each generated target and
  independently reloads/compares the animated output before external import.
- `pnpm verify:binding:ecosystem` repeats generation and verifies the exact
  Blender/Godot versions and build hashes in `scripts/ecosystem/runtime-pins.json`.
  Blender also evaluates mesh deformation. Godot verifies import and sampled
  bone playback; this headless gate does not claim GPU rendering quality.
- `pnpm verify:binding:browser` serves a local built-public-entry harness. Press
  **Run browser checks**. It uses native module Workers, compares Node/browser
  GLB bytes, tests cancellation/deadlines/ownership, retargets the generated
  target, and checks Three.js animated vertices and a WebGL preview. Tarball
  isolation and consumer declarations are checked separately by `verify:package`.

Generate new pinned external receipts with `pnpm update:binding:ecosystem`.
Commit generated receipts separately from handwritten code. Source algorithms
and API results stay **experimental**; passing these two cases does not certify
all A/T poses, clothing, disconnected surfaces, fingers or arbitrary characters.
