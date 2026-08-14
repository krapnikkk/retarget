# glTF extension fixture matrix

[简体中文](zh-CN/gltf-extension-fixtures.md)

The extension corpus is generated from a commit-pinned Khronos
`glTF-Sample-Assets` source. Source copies are verified byte-for-byte; the two
GLB declaration probes are deterministic minimal containers whose provenance
records and verifies the upstream SHA-256 before transformation. Run
`pnpm fetch:gltf-extension-fixtures` to materialize the corpus and
`pnpm check:gltf-extension-fixtures` to verify the committed copy.

| Extension | Official fixture | Current evidence | Certification status |
| --- | --- | --- | --- |
| `KHR_draco_mesh_compression` | `Box/glTF-Draco` | Container and extension declaration probe | Probe-only |
| `KHR_texture_transform` | `TextureTransformTest/glTF` | Container and extension declaration probe | Probe-only |
| `KHR_meshopt_compression` | `MeshoptCubeTest/glTF-Meshopt` | Container and extension declaration probe | Probe-only |
| `KHR_materials_variants` | `MaterialsVariantsShoe/glTF-Binary` | Minimal valid GLB and extension declaration probe | Probe-only |
| `KHR_lights_punctual` | `LightsPunctualLamp/glTF-Binary` | Minimal valid GLB and extension declaration probe | Probe-only |

Probe-only means that a licensed, hashed upstream source is either committed
directly or represented by a deterministic declaration-only derivative. The
two minimized GLBs intentionally omit upstream mesh, texture, and binary
payloads because no test consumes them. This evidence does not claim decoder
support, semantic preservation, or export round-trip compatibility.

The next fixture promotion candidates are `KHR_texture_basisu`/KTX2, VRM/MToon,
and a bounded unknown extension case. Each promotion must add structural reload,
semantic comparison, and ecosystem compatibility evidence before the
combination can be marked `certified`.
