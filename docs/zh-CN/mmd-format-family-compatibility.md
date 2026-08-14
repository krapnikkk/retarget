# MMD 格式族兼容性

> 本文是 [English](../mmd-format-family-compatibility.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

状态快照：2026-08-13。

本文是 PMX、PMD 和 VMD 的实现契约。原生 MMD 播放与跨生态人形转换必须分开：有效 MMD 文档可包含 VRM、FBX、BVH 或 glTF 人形目标无法表达的语义。

## 参考边界

- [`moeru-ai/three-mmd`](https://github.com/moeru-ai/three-mmd) 的提交 `f93c6486ece84ed90e305c529ba4996fd1368c57` 是 MMD Viewer 使用的 MIT 运行时。项目依赖发布版 `0.1.1`，且仅在预览 PMX/PMD 时加载。
- [`noname0310/babylon-mmd`](https://github.com/noname0310/babylon-mmd) 的提交 `3f523d392c176d5c9c9f9264f622d0631c1d298e` 是 MIT 语义和固定资源参考。其 PMX/PMD/VMD 行为通过 three-mmd 的解析器谱系间接使用；本项目不会把 Babylon.js 加入 Three.js 预览面。
- 实现仍是项目自有胶水和转换代码。参考仓库定义行为和测试用例，其源码不复制进项目模块。

## 能力矩阵

| 能力 | 原生 MMD Viewer | 跨格式转换 | 交付/往返 |
|---|---|---|---|
| PMX 网格及 BDEF/SDEF/QDEF 蒙皮 | 原生 three-mmd | GLB 兜底保留四权重蒙皮；以 glTF 权重近似 SDEF/QDEF | 配对 ZIP 保留原始 PMX 字节 |
| PMD 网格及 BDEF2 蒙皮 | 原生 three-mmd PMD reader | GLB 兜底保留双权重蒙皮 | 配对 ZIP 保留原始 PMD 字节 |
| Toon、sphere、边缘、漫反射/高光/环境材质 | 原生材质运行时 | 基础纹理和 PBR 近似；MMD 专用字段留在 glTF extras | 保留所有纹理边车及相对路径 |
| 骨骼标志、局部/固定轴、append/grant、IK | 原生运行时 | 解析为骨骼元数据；人形目标使用规范映射骨骼 | 原始模型分区逐字节保留 |
| 刚体、关节、Ammo 物理 | 原生运行时 | 通用人形动作无法表达 | 原始物理分区逐字节保留 |
| 顶点、骨骼、组、UV、材质、flip、impulse morph | 原生运行时 | 不压平成人形身体轨道 | 原始 morph 分区逐字节保留 |
| VMD 骨骼插值 | 原生 cubic Bezier | 规范重定向前以 30 FPS 烘焙 | 导出写入常规 MMD 插值字节 |
| VMD morph 轨道 | 匹配 PMX/PMD 上原生播放 | 在文档模型中计数和保留，不映射到人形角色 | 完整编解码往返 |
| VMD 摄像机、灯光、自阴影、可见性、IK 属性 | 完整解析并重写 | 在元数据中报告，不应用于人形目标 | 完整编解码往返 |
| 仅 VMD 检查 | Studio Mannequin 规范兜底 | 无模型时也可看到身体/手指层 | MMD Viewer 主选择器接受 |
| PMX/PMD + VMD 包 | 原生模型与动作预览 | 可选人形转换 | ZIP 保留每个原始条目，并加入无冲突的 `motion/` 文件 |

## 有意设置的边界

- MMD Viewer 当前不驱动 VMD 摄像机、灯光、音频、自阴影或 MME 效果。相关分区会解码，但不会伪装成人形动画。
- IK 控制骨骼没有与模型无关的人形等价物。它们在原生 PMX/PMD 播放中求解；纯动作 VMD 转换会报告未映射，而不是伪装成 FK 身体轨道。
- `animated-pmx` 是实验性姿势形变序列，并非 PMX 动画时间线，已从常规导出选择器移除。保留的适配器只追加骨骼 morph，不替换现有 morph、display、刚体、关节或软体分区。标准 MMD 交付仍是原始模型资源与 VMD 组成的 ZIP。

## 验证

```powershell
pnpm check:mmd-research-corpus
pnpm test:mmd-research-corpus
pnpm test
pnpm typecheck
pnpm build
```

研究语料不可变且被 Git 忽略。源、提交、许可证、哈希、大小和格式 magic 记录在 `docs/mmd-research-corpus.md` 及生成的本地清单中。
