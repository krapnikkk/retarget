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
- MMD（PMX/PMD）目标把 `hips` 映射到位于腿根下方的 `センター`，因此其静止 Hips 高度取 `左足`/`右足` 的平均高度，根位移仍作用在 `センター` 上。VMD 绑定到 MMD 目标时根位移不缩放，与 MMD 自身的播放方式一致；其他来源按腿根高度缩放。
- MMD 模型在 MMD 左手坐标系中面朝 -Z、左侧在 +X。VMD 导入先镜像到右手坐标系（MMD 前方变为 +Z），再旋转到规范的 -Z 前向基；VMD 导出是其精确逆变换。VMD 旋转相对于 MMD 模型的 A 字静止姿势，因此手臂链按 `MMD_STANDARD_ARM_REST_DEGREES`（34°，于 MMDAgent-EX Gene 实测）换基：上臂右乘静止偏移，前臂、手和手指以其共轭。
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

## 单片段编辑 v1

根接口 `editHumanoidMotion(original, edit, processingBudget?)` 与浏览器 Worker
`runRetargetJob({ type: "edit-humanoid", motion: original, edit }, { signal, deadlineMs, budget: { processing: processingBudget } })`
接收 `HumanoidClipEdit`：`{ schemaVersion: 1, startSeconds, endSeconds, speed }`。
每次从保留的原始 canonical clip 重建，编辑在映射、求解和脚步清理之前执行。
仅支持一个连续区间和正数恒定速度。时间归零，结果时长为 `(endSeconds - startSeconds) / speed`。
边界位移采用线性插值，旋转采用最短路径 SLERP；保留空间根偏移与源 FPS。
不取整关键帧、不重新居中空间轨迹，也不使用预览播放倍率。

结果具有新的确定性 canonical 身份，`metadata.clipEdit` 保存父动作身份与编辑参数，输入不变。
范围、版本和非有限数字错误使用 `PROCESSING_OPTION_INVALID`；输出分配前检查时长、帧数、采样和值数量预算。
取消或调用方指定的 deadline 会终止 Worker；消费者不得让过期结果覆盖新版本。
编辑能力不增加生态认证等级。

浏览器 bindMotionClipToAvatar 接收可选 jobOptions（budget 与 deadlineMs），
并传递给角色检查和目标求解。消费者可以在编辑与目标求解阶段共享预算。

## 目标绑定姿态修正（0.10.0）

`bakeHumanoidPoseEdits` 和可取消的 `pose-humanoid` Worker job 接收未修正、已绑定目标的 solved 动作。顺序为规范动作裁剪、映射/求解/Foot Cleanup、按列表应用 FK、再按列表应用双骨 IK，最后为预览/导出绑定目标。禁止对结果再次求解或叠加烘焙；调用方保留原始 canonical 和未修正 solved 供撤销、对比。

姿态配置 v1 绑定完整 humanoid-rest-v1 签名和静止姿态版本 1。换目标必须暂停修正，直到用户明确重新绑定或清除。最多 16 条修正，数值必须有限；每条包含开关、0–1 权重、起止时间、淡入淡出。片段内部的区间边界必须有正淡变；区间外及零权重保持原动作。烘焙保留原关键帧并增加 FPS 采样和淡变边界，受调用方处理预算约束。采样间采用 SLERP；IK 端点精度针对烘焙采样点，点间为插值近似。

FK 将 XYZ 欧拉角（度，±180）后乘至已映射关节的当前局部旋转，SDK 使用真实目标静止轴转换回规范旋转差。IK 目标点/弯曲参考点采用目标世界坐标、角色原生单位，包含根运动；sampleHumanoidTargetPose 可读取当前点位。手脚 IK 要求连续的上段/下段/末端骨骼和非零长度。不可达目标按可达距离限制并报 IK_UNREACHABLE；退化 pole 保留该采样姿态并报 IK_POLE_DEGENERATE；与原弯曲方向相反报 IK_BEND_FLIP。FK 可用于缩放骨架；检查器发现非均匀或反射缩放时禁用 IK。直接调用者须提供刚性、均匀缩放骨链。骨架签名的静止变换精度为 1e-5 单位。

结果 metadata.poseEdit 保存配置、有界告警和可复现结果 ID。VRMA 携带烘焙后的规范旋转，复现世界空间目标必须使用同一角色，第三方播放器不会强制骨架锁。Motion JSON 保留元数据；绑定的动画 GLB 和 baked VRM 保留实际目标。独立 glTF/BVH/FBX、动画 FBX、PMX/VMD 暂不允许导出修正动作，等待目标相关语义的独立证据。结构和语义重载不等于生态认证。不根据骨名推断镜像或姿态预设。
