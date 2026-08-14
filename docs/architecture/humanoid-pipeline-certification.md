# Humanoid pipeline certification

[简体中文](../zh-CN/architecture/humanoid-pipeline-certification.md)

Format availability is not evidence that a motion/avatar/export combination is
correct. Humanoid assurance is evaluated for the complete triple:

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
different scopes. The pinned Golden case below is `certified`; the broader
public `gltf-animation -> gltf-humanoid -> animated-glb` combination is beta
because one certified fixture does not certify every conforming glTF asset.

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
fixed random points, and 0/25/50/75/100 percent. Root motion can pass only when
meter-normalized offsets are declared. Structural reload, semantic equivalence,
and ecosystem compatibility remain separate result layers in export receipts.

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

The existing
market VRMA is retained as a provenance-locked candidate, but it is not treated
as equivalent to the normalized glTF source: it predates the canonical-space
contract and its axis signs differ. VRMA import now converts animated local
transforms through the file's T-pose and subtracts the rest hips position, while
VRMA export writes the absolute hips translation required by glTF animation.
That code-level roundtrip is covered by tests but does not upgrade the legacy
market artifact. BVH, VMD,
ActorCore, Mixamo-to-generic-FBX, FBX avatar, and PMX paths remain experimental
until provenance-locked real assets and equivalent evidence are added. Synthetic
fixtures may test math or failure handling but cannot promote assurance.
