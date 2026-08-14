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
  pass; the UI may describe this exact triple as beta.
- `certified`: structural, semantic, and named third-party ecosystem evidence
  all pass. Code refuses to derive this state from the status label alone.

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

The initial glTF-animation -> glTF-humanoid -> Animated-GLB case is deliberately
`semantic-passed`, not `certified`, because the newly composed output has not
yet completed a pinned Blender/Unity/Godot compatibility run. The existing
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
