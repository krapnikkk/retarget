# glTF 扩展固定资源矩阵

> 本文是 [English](../gltf-extension-fixtures.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

扩展语料从锁定提交的 Khronos `glTF-Sample-Assets` 生成。源副本逐字节验证；两个 GLB 声明探针是确定性最小容器，其来源记录并验证变换前上游 SHA-256。运行 `pnpm fetch:gltf-extension-fixtures` 可生成语料，运行 `pnpm check:gltf-extension-fixtures` 可验证已提交副本。

| 扩展 | 官方固定资源 | 当前证据 | 认证状态 |
|---|---|---|---|
| `KHR_draco_mesh_compression` | `Box/glTF-Draco` | 容器及扩展声明探针 | 仅探针 |
| `KHR_texture_transform` | `TextureTransformTest/glTF` | 容器及扩展声明探针 | 仅探针 |
| `KHR_meshopt_compression` | `MeshoptCubeTest/glTF-Meshopt` | 容器及扩展声明探针 | 仅探针 |
| `KHR_materials_variants` | `MaterialsVariantsShoe/glTF-Binary` | 最小有效 GLB 及扩展声明探针 | 仅探针 |
| `KHR_lights_punctual` | `LightsPunctualLamp/glTF-Binary` | 最小有效 GLB 及扩展声明探针 | 仅探针 |

“仅探针”表示已许可、有哈希的上游源被直接提交，或由确定性声明型衍生物表示。两个最小化 GLB 有意省略上游网格、纹理和二进制负载，因为没有测试消费它们。该证据不声明解码器支持、语义保留或导出往返兼容。

下一批候选包括 `KHR_texture_basisu`/KTX2、VRM/MToon 和有界未知扩展用例。每次提升必须加入结构重载、语义比较和生态兼容证据，组合才能标记为 `certified`。
