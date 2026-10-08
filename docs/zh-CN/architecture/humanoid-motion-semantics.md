# 人形动作语义

> 本文是 [English](../../architecture/humanoid-motion-semantics.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

人形管线有四个明确的语义阶段。格式适配器可以解析源数据，但不得把原始源局部值标为规范动作。

```text
RawImportedHumanoidMotion
  -> 源规范化
CanonicalMotion
  -> 面向目标的求解
SolvedHumanoidMotionClip
  -> 已验证的目标绑定
目标局部动画
```

## 规范契约

- 旋转轨道是在 VRM 人形坐标基中表达的、相对静止姿势的世界空间增量。四元数必须归一化并保持半球连续。
- Hips 平移轨道是相对静止姿势的世界空间偏移。源配置具有已知单位比例时使用米。
- 单位未知的源标记为 `offset-source-units`。其 Hips 轨道保留供检查，但除非源静止身高提供比例证据，否则目标绑定会忽略它，避免把 MMD 或任意 BVH 单位暗中当成米。
- BVH 从 Hips 到最低已映射脚/脚趾关节的层级偏移推导比例。VMD 没有模型骨架，因此使用显式的“标准模型静止 Hips 高度为 10 单位”预设，并在 `metadata.rootMotionEvidence.scaleSource` 中记录假设。该预设指腿根（`左足`）高度处的 Hips 关节，与其他格式的规范 `restHipsHeight` 一致；实测腿根高度为 10.48（MMDAgent-EX Gene）和 10.75（nanoem emapp `test.pmx`），对这两个模型约偏低 5–7%。VMD 导入与导出共用同一常量。
- 源规范化后，规范 Hips 平移始终是根相对偏移。`metadata.rootTranslationOrigin` 防止目标绑定再次减去源静止高度。
- glTF `STEP`、`CUBICSPLINE` 和 VMD 骨骼 Bezier 曲线按源插值求值，并重采样为有界线性轨道；`metadata.resampledTracks` 记录受影响轨道数。
- `metadata.normalizationVersion` 区分已规范化轨道和旧片段，防止配置覆盖重复转换同一数值。
- 规范动作不包含目标且结果可确定复现。`sourceCanonicalId` 是稳定语义内容的 SHA-256 标识；时钟时间、随机制品 ID、处理证据和目标绑定均不参与计算。
- 持久化制品身份放在 `MotionArtifactEnvelope` 中；其 `artifactId`、规范 ISO `createdAt` 和 `toolVersion` 都是调用方围绕规范动作提供的显式输入。

对于 glTF 和已解析 FBX，规范化读取每个已映射骨骼的源静止变换。绝对局部采样在坐标轴转换前变为相对静止姿势的世界增量；本身即增量的源跳过此步。

## 目标契约

加载的目标配置、可用人形骨骼、骨架树、完整骨架签名和静止 Hips 高度会在自动或手动映射前进入求解器。因此映射受真实目标约束，而非导入源时生成的诊断信息。求解结果会把完整签名记录为 `processing.targetRigRevision`；只有后续绑定阶段才会添加公开 `target` 对象。

共享目标绑定器把规范世界增量转换到目标轴基和父级局部静止基。通用角色预览、基于文档的 GLB/VRM/FBX 导出、流式 GLB 导出以及 PMX 骨骼形变导出均使用这些共享变换。节点动画输出为绝对目标局部值；PMX 骨骼形变按格式要求接收目标局部增量。

结构导出验证与语义认证保持分离。在后续加固阶段的 Golden Motion 清单和世界空间比较通过前，任何格式三元组都不得标记为已认证。
