# Humanoid binding evidence

The bare-landmark and existing-rig cases derive from the existing, SHA-256
pinned Quaternius CC0 mannequin recorded in `manifest.json`. The original
`SOURCE.txt` and `LICENSE.txt` remain beside that asset. No downloaded corpus or
model weights are added to the package.

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
skin. Its derived reference is used only for quality comparison.

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
- The pinned walk motion is retargeted to the generated target, and the
  animated output passes structural reload and semantic comparison.
- `verify:package` runs binding through the installed tarball's Node and
  browser-Worker entries.

The capability is **experimental**, so it has structural and semantic tests
only: no byte-exact receipts or external-runtime runs. Passing these cases does
not certify all A/T poses, clothing, disconnected surfaces, fingers or
arbitrary characters.
