# 人形管线认证

> 本文是 [English](../../architecture/humanoid-pipeline-certification.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

格式已有实现不能证明动作/角色/导出组合正确。人形保证针对完整组合评估：

```text
动作格式 x 角色格式 x 导出格式
x 执行模式 x 骨架检测模式
x 求解器修订 x 目标绑定修订
```

机器可读清单位于 `src/certification/golden-motion-v1.json`。用例可经历：

- `candidate`：来源已锁定，但语义证据不完整。
- `semantic-passed`：结构重载和确定性世界空间检查通过；消费端可将该精确组合描述为 beta。
- `certified`：结构、语义以及固定第三方生态回执要求的全部运行时均通过。代码不会仅根据状态标签推导该状态。

用例保证等级与泛化能力保证等级刻意采用不同范围。下述固定 Golden Animated GLB 用例为 `certified`。十二个更宽泛的公开组合为 beta：`gltf-animation -> gltf-humanoid` 的五种输出（`animated-glb`、`fbx-animation`、`vrma`、`gltf-animation`、`motion-json`）、`vrma -> gltf-humanoid -> animated-glb`，以及 `gltf-animation`、`bvh` 或 `vmd` 到 `vrm` 并输出 `baked-vrm` 或 `vrma`。`mixamo-fbx -> vrm -> vrma` 注册为 experimental：其 Mixamo 骨骼名 FBX 证据仅由本库 FBX 导出器生成，并非独立的 Mixamo 结构固定资源。一个已证明固定资源不能认证所有合规资产，因此只有第一个精确固定用例达到认证。

## Golden 证据

首个用例使用 `tests/fixtures/certification/golden-motion/` 下 SDK 自有副本：CC0 的 Quaternius Walk 与 Studio Mannequin Male。Golden 清单记录源 URL 和 SHA-256，并锁定规范时长、FPS、轨道数，以及 Hips、手、脚在首/中/末采样的值；它不依赖消费端发布目录。

集成门禁执行独立闭环：

```text
锁定的源动画
  -> 源规范化
  -> 真实目标骨架映射
  -> Animated GLB 导出
  -> 全新 glTF 导入
  -> 语义比较
```

语义比较使用验证器自有采样器和完整 Matrix4 FK。它直接检查导出 glTF 的世界旋转、Hips 位移和手脚位置，不把输出再次送入生产 glTF 动作导入器。确定性采样覆盖每个关键时间、关键点两侧的 epsilon、区间中点、角速度极值、接触状态切换、固定随机点及 0/25/50/75/100%。根偏移已为米制，或保留的源静止 Hips 高度证据已绑定到已知目标静止高度时，根运动才可通过。结构重载、语义等价和生态兼容在导出回执中始终是独立结果层。

下载门禁会阻止结构失败。来源已锁定的管线若语义失败也必须硬失败。没有锁定语义证据的组合若验证失败或不可用，下载实验文件前必须另行明确确认。内存证据不能提升流式路径：流式 GLB 验证通过范围读取追加动画访问器运行同一独立世界空间判定器，无需完整载入原始大型 BIN。

## 外部生态回执

初始 `glTF-animation -> glTF-humanoid -> Animated-GLB` 用例现已达到 `certified`。`pnpm verify:ecosystem` 会重新生成同一份已通过内部验证的 GLB、核验其 SHA-256，并在以下固定运行时中实际导入和采样：

- Blender 5.2.0 LTS，构建 `fbe6228777e7`；
- Godot 4.7.1 stable，构建 `a13da4feb8d8aefc283c3763d33a2f170a18d541`。

机器可读回执固定在 `src/certification/receipts/quaternius-walk-gltf-to-studio-mannequin-glb.json`。两个运行时都必须从同一产物导入网格、骨架/Armature 和动画，并在固定采样点观察到姿势变化。Unity 已明确延期，不属于当前本地认证配置要求的运行时，因此不声明 Unity 兼容性。

已锁定来源的 VRMA、重新生成的 BVH 及 VMD 输入，现均在各自精确公开路径达到 `semantic-passed`。BVH 导出会逆转规范坐标轴变换并保留完整手指层级；FBX 动作导出声明米制单位、只写入一次目标坐标基，并由 Three.js 独立回读。反向 VRMA、glTF Animation、Motion JSON、FBX Animation 和 Baked VRM 路径都针对固定三元组通过结构重载与语义检查。由于没有对应的外部生态回执，它们保持 beta 而非 certified。通用/市场 FBX 输入、FBX 角色输出及 PMX 交付仍为实验性。被忽略的 Gene PMX/VMD 语料已在本地通过目标绑定到 Animated GLB 的语义闭环，但在其精确可复现固定资源边界获准前，不能晋升默认公开组合。合成固定资源只能测试数学或失败处理，不能提升保证等级。
