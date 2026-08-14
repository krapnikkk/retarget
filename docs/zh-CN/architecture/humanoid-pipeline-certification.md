# 人形管线认证

> 本文是 [English](../../architecture/humanoid-pipeline-certification.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

“格式可用”不能证明动作/角色/导出组合正确。人形保证针对完整组合评估：

```text
动作格式 x 角色格式 x 导出格式
x 执行模式 x 骨架检测模式
x 求解器修订 x 目标绑定修订
```

机器可读清单位于 `src/certification/golden-motion-v1.json`。用例可经历：

- `candidate`：来源已锁定，但语义证据不完整。
- `semantic-passed`：结构重载和确定性世界空间检查通过；消费端可将该精确组合描述为 beta。
- `certified`：结构、语义以及固定第三方生态回执要求的全部运行时均通过。代码不会仅根据状态标签推导该状态。

用例保证等级与泛化能力保证等级刻意采用不同范围。下述固定 Golden 用例为 `certified`；更宽泛的公开 `gltf-animation -> gltf-humanoid -> animated-glb` 组合为 beta，因为一个认证固定资源不能证明所有合规 glTF 资源都已认证。

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

语义比较使用验证器自有采样器和完整 Matrix4 FK。它直接检查导出 glTF 的世界旋转、Hips 位移和手脚位置，不把输出再次送入生产 glTF 动作导入器。确定性采样覆盖每个关键时间、关键点两侧的 epsilon、区间中点、角速度极值、接触状态切换、固定随机点及 0/25/50/75/100%。只有声明米制规范偏移时根运动才能通过。结构重载、语义等价和生态兼容在导出回执中始终是独立结果层。

下载门禁会阻止结构失败。来源已锁定的管线若语义失败也必须硬失败。没有锁定语义证据的组合若验证失败或不可用，下载实验文件前必须另行明确确认。内存证据不能提升流式路径：流式 GLB 验证通过范围读取追加动画访问器运行同一独立世界空间判定器，无需完整载入原始大型 BIN。

## 外部生态回执

初始 `glTF-animation -> glTF-humanoid -> Animated-GLB` 用例现已达到 `certified`。`pnpm verify:ecosystem` 会重新生成同一份已通过内部验证的 GLB、核验其 SHA-256，并在以下固定运行时中实际导入和采样：

- Blender 5.2.0 LTS，构建 `fbe6228777e7`；
- Godot 4.7.1 stable，构建 `a13da4feb8d8aefc283c3763d33a2f170a18d541`。

机器可读回执固定在 `src/certification/receipts/quaternius-walk-gltf-to-studio-mannequin-glb.json`。两个运行时都必须从同一产物导入网格、骨架/Armature 和动画，并在固定采样点观察到姿势变化。Unity 已明确延期，不属于当前本地认证配置要求的运行时，因此不声明 Unity 兼容性。

现有市场 VRMA 保留为来源锁定候选，但不等同于已规范化 glTF 源：它早于规范空间契约，轴符号也不同。VRMA 导入现会通过文件 T-pose 转换动画局部变换并减去静止 Hips 位置；VRMA 导出写入 glTF 动画要求的绝对 Hips 平移。测试覆盖该代码往返，但不会提升旧市场产物。BVH、VMD、ActorCore、Mixamo 到通用 FBX、FBX 角色及 PMX 路径仍为实验性，直至加入来源锁定真实资产和同等级证据。合成固定资源只能测试数学或失败处理，不能提升保证等级。
