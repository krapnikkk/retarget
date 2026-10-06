# 非人形重定向契约

> 本文是 [English](../non-humanoid-retargeting-plan.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

本文定义有边界的非人形产品线，取代“每个 glTF 角色和每段 glTF 动画都能通过人形骨骼名配对”的假设。

## 产品边界

受支持输入是与显式活动定义匹配的**已绑定骨架**角色：`quadruped-v1`、`avian-v1`、`serpentine-v1`、`arachnid-v1` 或 `creature-v1`。产品不会创建 Armature、生成蒙皮权重、推断任意生物语义，也不承诺无关拓扑兼容。`creature-v1` 是明确的龙组合（身体、四腿、翅膀和尾巴），不是任意骨架逃生口。

完整 v1 路径：

```txt
已绑定骨架的非人形 glTF/GLB 动作
+ 具有相同活动定义的已绑定角色
-> 检查 family 与 definition
-> 映射语义 role
-> 同 rest-node-skin signature 复制，或按 definition 做 swing/twist 求解
-> 预览
-> Rig Motion JSON v2 / glTF Animation / Animated GLB
```

Humanoid Motion JSON v1 和现有人形管线无需迁移，继续受支持。GLB 等文件格式不代表 rig family。

## 语义层

实现分离四个概念：

1. **Rig family**：广义解剖结构，例如 `humanoid`、`quadruped`。
2. **Rig definition**：某 family 修订的稳定语义 role、必需链、接触点和缩放规则，例如 `quadruped-v1`。
3. **Rig profile**：具体骨架生态的别名、静止姿势和坐标轴约定，例如 `mesh2motion-fox`。
4. **Solver**：根据源和目标 definition 选择；仅凭文件格式 ID 绝不足以选择求解器。

五个活动非人形 definition 均具备 definition、规范与 Mesh2Motion profile、锁定 CC0 固定资源、求解路由和验收证据。只增加 family 标识绝不构成支持声明。

## Family 模块

- `quadruped-v1`：身体/颈、四条腿链、四个爪接触点、可选尾巴。
- `avian-v1`：身体、成对翅膀、成对腿/脚及尾羽。
- `serpentine-v1`：头/颈加规范化可变长度轴向链；源旋转按目标链长度重采样。
- `arachnid-v1`：身体加八条按序号定义的放射腿链及八个接触点。
- `creature-v1`：明确的龙模块，组合身体、四腿、成对翅膀和尾巴。

## `quadruped-v1`

必需 role：

```txt
root, pelvis, spine, chest, neck, head,
frontLeft.upper, frontLeft.lower, frontLeft.paw,
frontRight.upper, frontRight.lower, frontRight.paw,
hindLeft.upper, hindLeft.lower, hindLeft.paw,
hindRight.upper, hindRight.lower, hindRight.paw
```

可选 role 包括中间 spine/upper-spine 关节、shoulder/hip、ankle、toe/toe base、jaw、ear 和五段尾巴。它们保留生态细节轨道（包括完整 Mesh2Motion Fox 脊柱、脚和尾巴），但不会使额外段成为规范四足必需项。可选 role 可改善细节，却不能让必需链不完整的输入通过验证。

必需链为 body、neck 和全部四腿，paw role 是接触 role。v1 只通过 `root` 传递根平移，其他平移轨道有意忽略。缩放由映射后的静止姿势跨度推导，不使用硬编码动物身高。

## 动作协议

Rig Motion JSON v2 是并行协议，不会原地修改人形 v1 schema。每条轨道通过语义 `role` 寻址；文档还记录正确传递局部增量所需的源 definition/profile/signature 与静止姿势。

```json
{
  "schemaVersion": 2,
  "rigDefinitionId": "quadruped-v1",
  "family": "quadruped",
  "tracks": [
    { "role": "frontLeft.upper", "path": "rotation", "times": [0], "values": [0, 0, 0, 1] }
  ]
}
```

## 求解规则

- rest-node-skin v3 SHA-256 signature 相同后，还必须确认稳定节点索引、包含
  sibling index 的路径、拓扑和完整静止变换均一致，才可走 identity-copy 快速路径。
  名称只用于诊断显示，不能作为绑定主键。
- signature 不同但活动 definition 相同时，使用感知静止姿势的 chain swing/twist 传递。
- 局部旋转增量围绕各 role 的静止子轴分解，映射到目标静止轴，再合成到目标静止旋转。
- 根平移从源静止相对动作转换，并按目标/源静止姿势跨度缩放。
- family 或 definition 不匹配是硬兼容错误，不能警告后继续尽力执行人形求解。
- 必需链覆盖率必须为 100%；可选 role 可以缺失。

## 输出矩阵

| 输出 | 人形 v1 | 活动非人形 v1 definitions |
|---|---:|---:|
| Motion JSON | Humanoid Motion JSON v1 | Rig Motion JSON v2 |
| glTF Animation | 是 | 是 |
| Animated GLB | 是 | 是 |
| VRMA / baked VRM | 是 | 阻止 |
| VMD / PMX | 支持处为是 | 阻止 |
| BVH | 是 | 阻止 |
| FBX | 支持处为是 | v1 阻止 |

Studio 和目录必须从 rig definition 推导选项，不能把禁用的生态输出显示得仿佛转换已成功。

## 目录元数据和配对

每个生成资产记录：

```json
{
  "rigFamily": "quadruped",
  "rigDefinitionId": "quadruped-v1",
  "rigProfileId": "canonical-quadruped-v1"
}
```

固定资源准入会针对 GLB 验证声明的 definition。消费端目录和界面负责过滤不兼容选择；必须使用 SDK 兼容结果，不能从文件名猜测。

## Studio 检查和配方

Studio 显示检测到的 family/definition/profile，允许显式覆盖 family/profile，提供可视化链起点/终点映射和 JSON 配方导入导出。联动双视口可冻结两侧静止姿势并绘制每个映射关节的局部轴。诊断报告必需链覆盖率、拓扑冲突、缺失坐标轴、根缩放、接触与落地漂移、循环边界旋转/根增量。配方不包含也不再分发任何用户资产。

## 当前 beta 范围

粗粒度浏览器操作 `runRiggedGLTFPipeline` 负责从一对 rigged glTF 输入到 Animated GLB 输出的完整路径。beta 保证覆盖五个固定 Mesh2Motion 矩阵：Fox 的 Idle/Walk/Run/Jump 到 Fox、Dog、Horse（12 个配对）；Bird 的 Flap/Glide/Idle/Walk 到 Eagle（4）；七个 Snake 非静止动作到确定性缩放的 Snake 目标；九个 Spider 非静止动作到缩放的 Spider 目标；以及 Dragon 的 Fly Flap/Fly Glide/Idle/Walk 到缩放的 Dragon 目标。全部 36 个配对均通过结构重载和独立 glTF 采样器/世界变换判定器，且没有缺失轨道。

这些晋升只保证固定资源和 profile，不代表任意四足、鸟类、蛇形、蛛形、龙或所有 rigged glTF 配对均为 beta。外部 Blender 与 Godot 回执仍只覆盖独立的人形 Golden 产物。

## 固定资源和验收矩阵

`tests/fixtures/non-humanoid/mesh2motion` 下固定资源锁定到 Mesh2Motion 提交 `a9bf18a6007d7e12d197657f023f77a5e33473fe`。上游明确将所有模型、骨架和动画贡献为 CC0 1.0；每个文件都记录源路径和 SHA-256。四足固定资源覆盖：

1. 规范 identity motion（相同骨架/signature）；
2. 不同比例和局部骨轴；
3. 缺少必需前爪（硬失败）；
4. 缺少可选尾巴（通过）；
5. 人形/四足配对（硬兼容失败）；
6. 四个爪接触点及平移根；
7. Animated GLB 重载后真实 Three.js 播放；
8. Fox Idle/Walk/Run/Jump 针对 Fox、Dog、Horse 比例；
9. 可序列化映射诊断，供消费端自有可视化使用。

Bird、Snake、Spider、Dragon 固定资源覆盖其余四个 NH3 definition，包括已晋升动作矩阵及 20 关节到 8 关节的蛇形重采样。无骨架参考网格会在检查边界被拒绝。

SDK 验收要求：

- identity/rest 采样在四元数容差内保持不变；
- 所有必需链 100% 映射；
- family 不兼容配对由兼容 API 拒绝；
- 诊断报告源/目标 signature、根缩放、接触与漂移、循环边界、拓扑冲突、局部轴警告和缺失 role；
- Rig Motion v2 JSON 可往返；
- 导出的 glTF Animation 与 Animated GLB 以预期通道重载，并能通过 Three.js `AnimationMixer` 前进；
- 现有人形、浏览器运行时和导出测试保持通过。

生成的验收记录及认证哈希位于 `src/certification/non-humanoid-v1.json`，并由 `@krapnik/retarget/certification` 导出。固定资源准入不会把资产变为公共目录条目；目录发布仍有独立的清单、完整性、预览和发布门禁。
