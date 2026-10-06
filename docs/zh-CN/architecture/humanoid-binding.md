# 人形骨架拟合与蒙皮

[English](../../architecture/humanoid-binding.md)

`humanoid-binding-v1` 将 issue #6 实现为消费者中立、实验性的字节/JSON 能力。库负责拟合、关节修正、权重生成/编辑、校验和 GLB 导出；编辑器、gizmo、笔刷、历史持久化、预览场景和产品限额由消费端负责。

## 支持范围

| 项目 | v1 契约 |
| --- | --- |
| 容器 | 内容探测的 glTF 2.0 GLB，一个场景和一个嵌入 BIN，不请求外部资源。 |
| 姿态/拟合 | 直立人形、米、+Y 向上；显式 T/A pose 及 +Z/-Z 前向。比例模板结合实际表面采样距离，可提供世界空间关节中心。A pose 必须提供双侧上臂、肘、腕六标记。证据不足返回所需标记；结果是可编辑草稿，不是自动解剖识别。 |
| 已有骨架 | `use-rig` 接收显式角色、父子关系及世界绑定变换，不执行拟合。保留原无权重节点，另建规范骨架供 skin 引用；不自动识别任意旧骨架角色。 |
| 几何 | 有/无索引三角形、有限 FLOAT VEC3 位置；多 mesh/primitive 及带变换共享实例。拒绝退化三角形和未引用顶点。 |
| 拓扑 | 可独立处理开放、非流形、断开表面；断开组件返回人工复核诊断。同 primitive 中完全同位置顶点焊接，包括 UV/法线缝；重合独立壳体也可能耦合。 |
| 属性/资源 | 保留核心位置、法线、切线、UV、颜色、有效自定义属性、材质及嵌入 PNG/JPEG 字节；顶点数须一致。不解码图片或认证图片质量。 |
| 变换 | 有限正缩放 TRS，或非奇异、仿射、无反射/剪切的局部矩阵。实例世界变换计入 inverse bind；保留原节点索引/变换。 |
| 拒绝内容 | 已有 skin/JOINTS/WEIGHTS、动画、morph、稀疏 accessor、外部资源、相机节点、多场景及所有 glTF 扩展，包括可选扩展。顶层 `extras` 若存在必须是对象，以便加入命名空间化绑定元数据而不改变源值类型；对象 extras 会保留。不静默丢弃。 |
| 关节编辑 | 固定人形层级、必需角色、单位世界四元数、非零骨长。位置修改比例；不支持改层级或关节缩放。 |

姿态标签不能证明解剖正确，调用方需确认模型和草稿。v1 不含学习检测、体素内部计算、碰撞、镜像约束、体积保持或 corrective shape。服装、接触肢体、配件和手指尤其需要检查。

## 公共操作

一个粗粒度 `{ type: "humanoid-binding", bytes, command }` 任务提供独立的 `inspect`、`fit`、`use-rig`、`edit-rig`、`skin`、`edit-weights`、`export`、`validate`。每次 `bytes` 都是**原始静态资产**，不是上次导出的蒙皮 GLB；结果类型由命令推导。

```ts
import { runRetargetJob } from "@krapnik/retarget/browser";

const rig = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "fit", pose: "t-pose", forward: "+z", landmarks } });
const edited = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "edit-rig", snapshot: rig, expectedRevision: rig.revision,
    edits: [{ bone: "leftLowerArm", position: elbowWorldPosition }] } });
const skin = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "skin", snapshot: edited, expectedRevision: edited.revision } });
const output = await runRetargetJob({ type: "humanoid-binding", bytes: inputBytes,
  command: { operation: "export", snapshot: skin, expectedRevision: skin.revision } });
// output.bytes 为 Uint8Array，output.validation 包含结构与变形报告。
```

Node 使用 `@krapnik/retarget/node` 的 `runNodeToolJob`，返回 `{ ok, result }` 或 `{ ok: false, error }`。受信任工具可显式使用 `@krapnik/retarget/io` 的 `processHumanoidBinding(bytes, command, options)` 内联执行，不公开场景对象。

## 编辑与失效

快照 schema version 为 1，可 JSON 保存恢复，原资产字节单独保存。资产 SHA-256、拓扑及 `node:N/mesh:M/primitive:P` 定位固定顶点，包括共享 mesh 的不同实例。仅改资产元数据也拒绝旧快照，不自动迁移。

`revision` 覆盖完整快照，`rigRevision` 覆盖完整关节数据；是内容身份，不是时间戳或身份认证。无实际变化的编辑可能保留修订。`expectedRevision` 必须匹配被编辑快照。库无状态：消费端应用异步结果前，还须比较当前修订与派发时捕获的修订；匹配的旧快照/token 不能让库感知消费端已有更新。

关节位置/旋转为绝对场景世界值，后代不隐式跟随，需提交所有预期变化。绑定变换修改清空权重及求解记录、保留锁定、要求重新蒙皮。导出关节携带新修订进入既有目标签名，旧动作在普通/流式导出器均触发 `TARGET_RIG_MISMATCH`。只改权重不改变骨架身份。生成 GLB 是 `Source -> Canonical -> Target` 的显式目标。

每行 `edit-weights` 指定 primitive ID 和 vertex。`influences` 替换未锁定候选，正权重按权重及规范角色顺序排序、裁剪、归一化；拒绝零总量、非法/重复骨骼。`locks` 替换整行约束，`[]` 解锁，零锁定排除骨骼。正锁定在 JSON 中精确保留并占槽，剩余质量分给未锁定正候选。锁定超额、超过四个正锁定、没有候选/槽时返回 `BINDING_CONSTRAINT_CONFLICT`。再次蒙皮保留锁定、覆盖未锁定人工编辑；锁定仅影响自身顶点，不扩散到邻居。

四影响是 **v1 输出 profile**，不是 glTF 普遍限制。权重和容差 `1e-6`；GLB FLOAT 舍入双精度编辑权重。绑定/变形位置容差为 `max(1e-6 米, 角色身高 * 2e-5)`。

## 算法、预算与可复现性

`surface-heat-v1` 是原创基线：最近骨骼线段种子、精确焊接三角邻接上的 screened Jacobi 扩散、带约束四影响归一化。不是 Blender bone heat、体素热扩散、BBW 或 ML，未复制应用代码。`iterations` 为 1–256 整数，默认 32；末端外推，分叉采用规范角色顺序的首个子节点。

快照/GLB 不含随机、时钟或地区排序。相同字节、命令数据/顺序、算法、选项及固定工具链可复现字节；验证了重复运行及指定夹具 Node/Chromium 一致性。不保证任意引擎/工具链逐字节一致；数值边界为 Float64 计算、Float32 存储及语义容差。JSON 键顺序属于快照表示，支持标准 stringify/parse，不支持任意重排。

浏览器选项包括 `signal`、`onProgress`、`deadlineMs`、`bufferOwnership`、`budget: { parse, processing }`。默认所有权只执行一次 `postMessage` 复制，transfer 使输入 detached。大型快照请求校验在有界分块间让出事件循环；快照结果通过内部 Transferable 关节/权重缓冲传输，主线程再分段恢复并重新验证完整 JSON revision 和每项权重。该传输结构不是公开快照类型。取消/硬截止终止 Worker，内循环另有检查点，Worker 不可用直接失败。Node 使用对应平台选项，`budget.softDeadlineMs` 同时由父进程执行硬截止。

消费端显式设置字节、顶点/索引/骨骼及生成值预算。`maxGeneratedValues` 限制解码 accessor 标量数及 `vertices * joints * (iterations + 3)` 估算；结合字节/索引预算控制工作量，但不是实测峰值 RAM 配额。不引入产品文件大小/耗时默认值，输出重载前也受限。进度报告阶段，不预测剩余时间。

公共错误区分 `BINDING_INPUT_UNSUPPORTED`、`BINDING_LANDMARKS_REQUIRED`、`BINDING_RIG_INVALID`、`BINDING_EDIT_STALE`、`BINDING_WEIGHTS_INVALID`、`BINDING_CONSTRAINT_CONFLICT`、解析/处理预算、截止和取消。浏览器取消为 `AbortError`，Node 为 `OPERATION_CANCELLED`。

## 证据与 issue #6 逐项审计

[固定夹具与证据说明](../../../tests/binding/README.md)记录授权、派生、质量阈值及生态回执。两条 T-pose 流程通过重载、五姿势独立顶点比较、重定向动画检查，以及固定 build hash 的 Blender 5.2.0 LTS/Godot 4.7.1 导入播放。Blender 另采样求值顶点；Godot 是无头骨骼播放，不代表 GPU 渲染。派生 A-pose 通过本地质量/语义测试，无单独生态认证。所有 API 输出仍为 **experimental**。

| 验收项 | 证据 |
| --- | --- |
| 裸网格/已有骨架 | 两个合法固定案例，求解前移除原权重。 |
| 关节修正/旧动作失效 | 绑定变换修改；普通及流式导出集成。 |
| 权重编辑/恢复 | 归一化、裁剪、锁定/解锁/冲突、JSON 恢复和过期输入。 |
| 真实 skin/绑定表面 | 全顶点五姿势、合法权重/索引/IBM、损坏反例。 |
| 资源保留 | 带变换共享实例、多 primitive、嵌入纹理、属性丢失检测。 |
| 质量与合法性分开 | 肩/肘/髋/膝艺术家权重对比，全髋绑定失败反例。 |
| 显式目标/生态 | 既有重定向、原生浏览器顶点播放、两份固定 DCC/引擎回执。 |
| 保守保证等级 | API 保持实验性，具体案例证据不扩散到其他输入。 |
| 负向路径 | 畸形缓冲、扩展、变换、循环、退化/未引用几何、约束、预算、过期编辑及执行中取消；断开表面带诊断处理。 |
| 打包/执行 | 真正 tarball 声明/入口、Node/打包浏览器 Worker，以及包含 10 万顶点快照调用返回、首次进度、完成、总耗时分段和主线程 heartbeat 门禁的单独原生 Chromium 实测。 |

开发 binding 时运行 `pnpm test:slow`，`pnpm verify` 运行全仓门禁，`pnpm verify:binding:ecosystem` 重跑外部运行时。重新生成的回执/锁可以与引起变化的改动一起提交，任何消费端仓库均不作为门禁。
