# 规范资产输入格式（v1）

> 本文是 [English](../asset-input-format.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

本 v1 文档是规范的**人形**契约。已绑定骨架的非人形 GLB 使用 `docs/non-humanoid-retargeting-plan.md` 定义的版本化 Rig Definition、目录骨架元数据及 Rig Motion JSON v2。不要把尾巴、翅膀或动物腿加入 v1 人形骨骼列表。

这是 SDK 自有转换和验证的受控输入契约。每个获准角色和动作固定资源在进入规范管线前，必须是符合本文的 **GLB**。单一输入约定让所有导出适配器依赖同一组显式假设。

这不是新文件格式，也不是适配器注册表中的新 `AvatarFormatId`/`MotionFormatId`。它是现有 `gltf-humanoid` / `gltf-animation` 导入契约的严格子集，供 Blender 导出脚本和固定资源审查使用统一检查表。

**固定资源准入暂时封闭。** 本规范仅管理 SDK 自有 Blender-to-GLB 固定资源及验证输入；没有公共固定资源仓库或第三方提交流程。消费端的资产发布和目录政策不属于本包。

---

## 为什么选择 GLB，以及为何采用本约定

下列规范骨骼名就是 VRM 1.0 人形骨骼名，也是项目内部 `HumanoidBoneName` 联合类型（`src/retarget/types.ts`）。VRM 人形骨架是严格且广受支持的“规范人形”约定，项目已将其作为枢纽格式；`src/profiles/humanoid.ts` 中 `VRM_HUMANOID_PROFILE` 的每根骨骼都原名映射。由此可获得：

- **VRM 创作零骨骼改名**：`leftUpperArm` 直接映射同名 VRM humanoid slot。
- **GLB/Animated GLB 零骨骼改名**。
- 通过单一、明确的反向映射表 `bone-naming.ts` 转换为 Mixamo、ActorCore、BVH-standard 和 MMD 名称，以导出 FBX、BVH、VMD。

## 必需与可选骨骼

所有骨骼名来自 `src/retarget/types.ts` 的 `HUMANOID_BONES`（共 55 根）。其中只有一部分承载核心语义；求解器和所有导出适配器会对其余骨骼优雅降级。

**必需**（必须存在且参与蒙皮；与 `REQUIRED_VRM_BONES` 一致）：

```txt
hips, spine, head,
leftUpperArm, leftLowerArm, leftHand,
rightUpperArm, rightLowerArm, rightHand,
leftUpperLeg, leftLowerLeg, leftFoot,
rightUpperLeg, rightLowerLeg, rightFoot
```

**推荐**（大多数高质量角色/动作资产都包含）：

```txt
chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes
```

**可选**（手指骨骼；手部细节动作可包含，否则可完全省略）：

```txt
left/right ThumbMetacarpal, ThumbProximal, ThumbDistal,
IndexProximal, IndexIntermediate, IndexDistal,
MiddleProximal, MiddleIntermediate, MiddleDistal,
RingProximal, RingIntermediate, RingDistal,
LittleProximal, LittleIntermediate, LittleDistal
```

每根手指须按手侧完整提供：一旦包含某根手指骨骼，就要包含该手指完整 `proximal -> intermediate -> distal` 链，因为只有源和目标都暴露完整链时，求解器才传播手指轨道。

## 节点命名

导出 GLB 中的骨骼节点名必须**精确**使用规范名，例如 `leftUpperArm`，不能使用 `LeftUpperArm`、`mixamorig:LeftArm` 或 `left_upper_arm`。通用 glTF 人形配置虽会兜底接受全小写变体，但目标始终是精确规范大小写，不要依赖兜底。

非人形节点（根/Armature 包装节点、网格节点）可以任意命名；只有人形关节节点按名称匹配。

## 骨架层级

系统使用 GLB 中**实际父子节点结构**，导入器不强制硬编码“预期”层级：

- 在 Blender 中按自然方式构建。典型参考是 `hips -> spine -> chest -> upperChest -> {neck -> head, leftShoulder -> …, rightShoulder -> …}`，以及 `hips -> {leftUpperLeg -> …, rightUpperLeg -> …}`，但不强制。
- 每个人形关节仍须从场景默认根可达，并能通过 `updateMatrixWorld` 产生合理世界变换；不得存在未解析或断开的关节。

## 静止姿势

- 使用 **T-pose**：手臂水平伸展，手掌向下或向前。这与 `VRM_HUMANOID_PROFILE` 的 `restPose: "normalized"` 及 VRM 规范静止约定一致。
- 管线会把静止时 `hips` 的世界 Y 位置作为缩放规范化参考高度。角色必须以真实静止高度站在原点，不能带偏移。

## 坐标轴、单位和比例

| 属性 | 值 |
|---|---|
| 上轴 | +Y |
| 前轴 | −Z（glTF 约定） |
| 单位 | 1 单位 = 1 米 |
| 比例 | 使用真实世界米制身高（成人约 1.7）；节点变换中不得烘焙任意骨架缩放因子 |

这与 `VRM_HUMANOID_PROFILE` 的 `upAxis: "y"`、`forwardAxis: "-z"`、`scaleUnit: "meters"` 完全一致。使用 Blender glTF 导出器默认坐标转换（+Y 向上）即可生成该约定。

## 网格和蒙皮

- 可以有一个或多个网格，每个网格一个或多个 primitive；按材质拆分是正常且预期的。
- 必须三角化；每个 primitive 要有 `POSITION`、`NORMAL`、`TEXCOORD_0`。
- 蒙皮 primitive 必须带 `JOINTS_0`/`WEIGHTS_0`，**每顶点最多 4 个骨骼影响**，权重和为 1。这是硬上限：FBX cluster writer 和 PMX 权重格式均最多 4 个影响（等同 BDEF4），超过部分会在下游静默截断，因此 Blender 中不能依赖 5 个以上影响。
- 每个蒙皮网格都要有带 `inverseBindMatrices` 的 `Skin`；Blender glTF 导出器会为 Armature 父级网格自动生成。

## 材质和纹理

- 每个材质应有 `baseColorFactor` 和/或 `baseColorTexture`。纹理须以 PNG/JPEG **嵌入** GLB，不能引用外部文件。
- 目前只有基础色保证能保留到所有导出目标。FBX 会将其嵌入 `Video`/`Texture` 节点，VRM/PMX 创作需在各自阶段决定映射。暂不能依赖金属度/粗糙度、法线贴图或自发光在非 GLB 导出中保留。

## 动作资产要求

- 导出为只包含动画、无网格的 GLB，目标为同一组规范关节名，按 **30 FPS** 采样。
- `hips` 必须同时有旋转和平移轨道（根运动）；其他骨骼最多需要旋转轨道。
- 每个文件只包含一个无缝片段；idle/walk/run 等分别存储。管线不负责切分片段。

## 元数据

元数据写入 Blender 自定义属性，并由导出脚本带到边车 JSON；不要写进 GLB 二进制：

```json
{
  "name": "walk-01",
  "kind": "motion",
  "author": "…",
  "license": "CC-BY-4.0",
  "sourceUrl": "https://…",
  "sourceBlendFile": "walk-01.blend",
  "notes": "…",
  "published": true,
  "loop": true,
  "rigFamily": "humanoid",
  "rigDefinitionId": "humanoid-v1",
  "rigProfileId": "canonical-humanoid-v1"
}
```

`kind` 也可以是 `character`。`license` 必填；公开值仅允许规范标识 `CC0-1.0` 或 `CC-BY-4.0`。CC-BY-4.0 必须提供 `sourceUrl`，第三方 CC0 也推荐提供。动作资产必须显式提供布尔值 `loop`；`published` 是必需的明确发布决定；旧数据未写 `rigFamily` 时默认为 `humanoid`。

目录管线从源 GLB 相邻的 `meta.json` 读取此结构。未知或自定义许可证会被拒绝。语料元数据必须保留源 URL、SHA-256、许可证、需要时的作者以及再分发分类。产品发布政策是消费端职责，不属于 SDK 输入契约。

新的非人形固定资源必须明确声明 rig family、definition 和 profile。准入验证 definition 属于该 family、profile 属于该 definition，并确认 GLB 映射全部必需角色。

## 验证检查表

导出 GLB 被视为管线就绪前：

- [ ] 15 根必需骨骼全部存在并精确命名；角色资产中参与蒙皮，动作资产中被动画驱动。
- [ ] 预期识别人形的关节节点没有使用 `HUMANOID_BONES` 列表外的骨骼名。
- [ ] T-pose 静止姿势、真实米制比例、+Y 向上/−Z 向前。
- [ ] 每顶点不超过 4 个关节影响，权重和为 1。
- [ ] `baseColorTexture` 嵌入而非外部引用。
- [ ] 通过项目自身导入路径干净加载：角色的 `loadCanonicalAvatarRig` 报告零 `missingRequiredBones`，或 `gltf-animation` 动作导入器解析时没有缺轨警告。

运行 `pnpm validate-asset <file.glb> --kind character|motion` 自动执行硬性检查。静止姿势和米制比例只能尽力警告，仍需人工审查。

四足源还应传入完整语义契约，例如：

```powershell
pnpm validate-asset .\dog.glb --kind character --rig-family quadruped --rig-definition quadruped-v1 --rig-profile canonical-quadruped-v1
```

## 版本管理

当前为 **v1**。如果必需骨骼集合或比例约定等发生变化，必须提升版本并在此记录。已进入管线的资产会绑定导出时的规范修订，因此约定变化不能静默使既有导出失效。
