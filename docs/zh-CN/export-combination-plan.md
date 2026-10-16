# 导出组合契约

> 本文是 [English](../export-combination-plan.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

本文描述调度和证据边界，刻意不重复实时格式或适配器矩阵。

## 当前状态来源

| 关注点 | 权威来源 |
|---|---|
| 格式目录和保证等级 | `src/formats/catalog.ts` |
| 可调用导出适配器 | `src/adapters/export/index.ts` |
| 人形动作/角色配对 | `src/pipelines/registry.ts` |
| 骨架家族输出能力 | `src/rigs/capabilities.ts` |
| 人形认证用例 | `src/certification/golden-motion-v1.json` |
| Golden 固定资源来源 | `tests/fixtures/certification/golden-motion/` |

这些来源不一致时测试必须失败。Markdown 表格永远不是启用导出的权威来源。

## 保证等级模型

格式目录只包含已经实现的格式；`assurance` 记录精确能力背后的证据：

- `experimental`：结构或语义证据不完整。
- `beta`：精确用例具备锁定的结构和语义证据。
- `certified`：还必须具备具名、锁定版本的生态兼容证据；标签本身不能提升状态。

认证范围是完整元组：

```text
动作格式 x 角色格式 x 导出格式
x 执行模式 x 骨架检测模式
x 求解器修订 x 目标绑定修订
```

因此，公开人形流水线查询必须提供动作、角色和导出格式 ID。注册表现准入十二个 beta 组合：`gltf-animation -> gltf-humanoid` 的五种输出（`animated-glb`、`fbx-animation`、`vrma`、`gltf-animation`、`motion-json`）、`vrma -> gltf-humanoid -> animated-glb`，以及 `gltf-animation`、`bvh` 或 `vmd` 到 `vrm` 并输出 `baked-vrm` 或 `vrma`。`mixamo-fbx -> vrm -> vrma` 注册为 experimental：其 Mixamo 骨骼名 FBX 证据仅由本库 FBX 导出器生成，并非独立的 Mixamo 结构固定资源。这些固定用例均有结构重载与独立语义证据；只有第一个 Golden Motion 固定用例另在 Blender 与 Godot 中达到认证。

非人形 rigged glTF 使用独立的粗粒度浏览器入口 `runRiggedGLTFPipeline`。Fox 四足、Bird/Eagle、Snake、Spider 和 Dragon 五个固定 family 的 Animated GLB 矩阵为 beta；其 36 个锁定动作/目标配对不会泛化为所有 rigged glTF 配对。

## 调度边界

- 纯动作导出器消费规范或已重定向动作，不虚构角色。
- 承诺组合场景的角色导出器需要目标角色和已绑定动作，除非适配器契约另有明确规定。
- 当前 FBX 场景写入器需要已绑定动作，因此独立角色 FBX 有意保持不可用。
- `VRM + external VRMA` 是包契约，不是单个改名文件。
- Animated PMX 与从规范 GLB 创作 PMX 模型是不同的实验能力。PMX 没有标准嵌入动画时间线；兼容时，常规 MMD 交付仍是模型加 VMD。
- 非人形输出由 Rig Definition 通过 `src/rigs/capabilities.ts` 选择。`.glb` 扩展名并不代表人形或生物兼容性。
- 导入探测、求解器、验证和导出器都保持显式 `Source -> Canonical -> Target` 边界。

## 证据边界

结构重载只证明发出的字节可再次解析。语义比较独立检查目标世界空间动作。生态兼容性独立检查具名外部消费端。回执和 UI 标签必须分开这三层。

提升状态需要：

1. 锁定的源和目标来源；
2. 对发出产物进行结构重载；
3. 由验证器自有逻辑在所需采样上进行语义比较；
4. `certified` 需要具名生态兼容证据；
5. 清单条目把证据绑定到精确元组。

合成固定资源可以测试编解码器、限制或失败处理，但不能提升保证等级。

## 当前缺口

- 为只有结构或语义证据的精确人形用例补充锁定的外部消费端证据。
- PMX 交付、通用/市场 FBX 输入及独立 VMD 输出继续受门禁限制，直至可复现的已提交固定资源和同等级语义证据覆盖所声明范围。被忽略的 Gene 研究语料只提供本地辅助证据，不是默认 beta 固定资源。
- 非人形输出选项只能通过有版本 Rig Definition、能力条目、求解器路由和生成的认证结果扩展。

## 维护规则

导出发生变化时，同步更新其注册表、适配器、兼容选择器、测试及认证清单。已完成项应从本文删除；不要追加带日期的“已实现”章节或第二份能力矩阵。
