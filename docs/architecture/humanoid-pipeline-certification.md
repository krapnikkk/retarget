# Humanoid pipeline certification

[简体中文](../zh-CN/architecture/humanoid-pipeline-certification.md)

An implemented format is not evidence that a motion/avatar/export combination
is correct. Humanoid assurance is evaluated for the complete triple:

```text
motion format x avatar format x export format
x execution mode x rig detection mode
x solver revision x target-binding revision
```

The machine-readable manifest is
`src/certification/golden-motion-v1.json`. A case may progress through:

- `candidate`: provenance is locked but semantic evidence is incomplete.
- `semantic-passed`: structural reload and deterministic world-space checks
  pass; consumers may describe this exact triple as beta.
- `certified`: structural, semantic, and all runtimes required by the pinned
  third-party ecosystem receipt pass. Code refuses to derive this state from
  the status label alone.

Case assurance and generalized capability assurance are intentionally
different scopes. The pinned Golden Animated GLB case below is `certified`.
Twelve broader public combinations are beta: five
`gltf-animation -> gltf-humanoid` outputs (`animated-glb`, `fbx-animation`,
`vrma`, `gltf-animation`, and `motion-json`),
`vrma -> gltf-humanoid -> animated-glb`, and `gltf-animation`, `bvh`, or `vmd`
to `vrm` with `baked-vrm` or `vrma` output. `mixamo-fbx -> vrm -> vrma` is registered as experimental: its only Mixamo-named FBX evidence is written by this library's FBX exporter, not an independent Mixamo-structured fixture. One proven fixture does not certify
every conforming asset, so only the first exact pinned case is certified.

## Golden evidence

The first case uses SDK-owned copies of the CC0 Quaternius Walk and Studio
Mannequin Male fixtures under
`tests/fixtures/certification/golden-motion/`. The Golden manifest records their
source URLs and SHA-256 values and locks canonical duration, FPS, track count,
and first/middle/last samples for hips, hands, and feet. It does not depend on a
consumer release catalog.

The integration gate performs this independent loop:

```text
locked source animation
  -> source normalization
  -> real target rig mapping
  -> Animated GLB export
  -> fresh glTF import
  -> semantic comparison
```

Semantic comparison uses a validator-owned sampler and complete Matrix4 FK. It
checks raw exported glTF world rotations, hips displacement, and hand/foot
positions without passing the output back through the production glTF motion
importer. Deterministic sampling includes every key time, epsilon samples around
keys, interval midpoints, angular-velocity extrema, contact-state transitions,
fixed random points, and 0/25/50/75/100 percent. Root motion can pass when
offsets are already meter-normalized or when preserved source-rest-height
evidence is bound to a known target rest height. Structural reload, semantic
equivalence, and ecosystem compatibility remain separate result layers in
export receipts.

The download gate blocks structural failures. A semantic failure on a
provenance-locked pipeline is also a hard failure. For combinations without
locked semantic evidence, failed or unavailable semantic validation requires a
separate explicit confirmation before an experimental file is downloaded.
In-memory evidence never promotes the streamed path: streamed GLB validation
range-reads the appended animation accessors and runs the same independent
world-space oracle without loading the original large BIN payload in full.

## External ecosystem receipt

The initial `glTF-animation -> glTF-humanoid -> Animated-GLB` case is
`certified`. `pnpm verify:ecosystem` regenerates the same internally validated
GLB, verifies its SHA-256, and imports and samples it in these exact runtimes:

- Blender 5.2.0 LTS, build `fbe6228777e7`;
- Godot 4.7.1 stable, build
  `a13da4feb8d8aefc283c3763d33a2f170a18d541`.

The machine-readable receipt is pinned at
`src/certification/receipts/quaternius-walk-gltf-to-studio-mannequin-glb.json`.
Both runtimes must import a mesh, skeleton/armature, and animation and must show
pose changes across fixed samples of the same artifact. Unity is explicitly
deferred and is not a required runtime in the current local certification
profile; no Unity compatibility is claimed.

The provenance-locked VRMA, regenerated BVH, and VMD inputs now reach
`semantic-passed` on their exact public paths. BVH export reverses the canonical
axis transform and preserves the complete finger hierarchy; FBX animation
export declares meter units, writes the target basis once, and is independently
reloaded through Three.js. The reverse VRMA exporter, glTF Animation exporter,
Motion JSON exporter, FBX animation exporter, and Baked VRM paths all pass
structural reload and semantic checks for their pinned triples. They remain beta
rather than certified because no matching external ecosystem receipt is pinned.
Generic/market FBX input, FBX avatar output, and PMX delivery remain
experimental. The ignored Gene PMX/VMD corpus passes a local target-binding to
Animated GLB semantic loop, but cannot promote a default public combination
until its exact reproducible fixture boundary is admitted. Synthetic fixtures
may test math or failure handling but cannot promote assurance.
