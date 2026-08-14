# MMD 研究语料

> 本文是 [English](../mmd-research-corpus.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

该本地语料为 MMD 格式族研究和转换测试准备真实 PMX、PMD、VMD 输入。二进制文件位于被 Git 忽略的 `references/mmd/research-corpus/`。它们不是公共目录输入；未经单独发布审查，不得复制到 `assets/`、`public/` 或发布包。

## 复现或验证

```powershell
pnpm fetch:mmd-research-corpus
pnpm check:mmd-research-corpus
pnpm test:mmd-research-corpus
```

拉取器将每个源锁定到不可变提交，并验证文件大小、SHA-256 及 PMX/PMD/VMD magic 字节。它会下载缺失文件，默认拒绝替换不匹配的本地文件，并写入本地 `manifest.json`。只有有意恢复不匹配语料时才使用 `--force`。聚焦测试会运行生产 PMX/PMD 转换和 VMD 导入路径；若被忽略的下载内容不存在，常规测试套件会跳过此语料测试。

## 语料清单

### MMDAgent-EX CG-CA Gene

- 来源：<https://github.com/mmdagent-ex/gene>
- 提交：`c7eace43dffaccff6ad0597433ef85fa57c91e03`
- 许可证证据：锁定的 `README.md` 声明仓库文件为 CC BY 4.0 并提供必需署名；同时单独保留商标和设计权并限制允许用途。除非预期产品用途已解决这些独立权利，否则本源只用于学术转换研究参考。
- 模型：`Gene_light.pmx`、`Gene_light.pmd`，以及 `light/` 下全部 12 个文件。
- 动作：`00_normal.vmd`、`01_happy.vmd`、`16_thinking.vmd`、`22_apology.vmd`、`stand.vmd`。
- 价值：同一发布方提供匹配 PMX/PMD 对，含相同 224 骨骼人形、184 morph、13 材质、外部纹理、物理和动作；轻量纹理使本地语料约为 10 MB。

### babylon-mmd 解析器固定资源

- 来源：<https://github.com/noname0310/babylon-mmd>
- 提交：`3f523d392c176d5c9c9f9264f622d0631c1d298e`
- 许可证证据：锁定仓库 `LICENSE`（MIT）。
- PMX 用例：骨骼标志、层级、约束、UV morph，以及带引用 `ref.jpg` 的纹理 matcap 样例。
- VMD 用例：两个小型物理开关固定资源，其中一个含身体轨道，另一个仅含不支持轨道。
- 价值：体积极小，适合解析器边界和功能回归测试。若干文件有意不是完整人形角色。

### nanoem emapp 固定资源

- 来源：<https://github.com/hkrn/nanoem>
- 提交：`30acffaa29f5d2eb9e997d69418f2e4b97b5894f`
- 许可证证据：锁定的 `LICENSE.md`、`LICENSE.MPL`、`LICENSE.MIT`。`LICENSE.md` 将包含这些固定资源的 `emapp` 组件归为 MPL；所选文件按 MPL-2.0 对待。
- PMX 用例：`emapp/test/fixtures/test.pmx` 与 `emapp/test/fixtures/effects/main.pmx`。
- 价值：独立实现提供的 140 骨骼表、材质、纹理引用和效果结构。它们没有网格顶点，因此只作为解析器固定资源，不用于角色预览。

## 当前项目冒烟结果（2026-08-13）

下载语料在未改变转换代码的情况下通过生产解析器运行：

| 输入 | 结果 |
|---|---|
| `Gene_light.pmx` | 转为一个蒙皮网格、226 节点、13 primitives、一个 skin、13 个已解析纹理 |
| `Gene_light.pmd` | 转为一个蒙皮网格、226 节点、13 primitives、一个 skin、13 个已解析纹理 |
| `01_happy.vmd` | 完整解码；50 条规范身体/手指轨道、345 个 morph 帧、10 秒文档范围 |
| `16_thinking.vmd` | 完整解码；50 条规范身体/手指轨道、10 秒 |
| `22_apology.vmd` | 完整解码；50 条规范身体/手指轨道、10 秒 |
| `stand.vmd` | 完整解码；50 条规范身体/手指轨道、4 秒 |
| `00_normal.vmd` | 预期负例：当前没有受支持身体轨道 |
| babylon-mmd PMX 集 | 所选五个文件全部解析；零顶点骨骼固定资源仍仅供解析器使用 |
| babylon-mmd VMD v2 | 预期负例：仅含不支持轨道 |
| babylon-mmd VMD v3 | 已导入；8 条受支持轨道，约 0.67 秒 |
| nanoem PMX 集 | 两个文件均已解析；零顶点固定资源仍仅供解析器使用 |

生产编解码器现可解析并重写所有标准 VMD 分区；原生 PMX/PMD Viewer 通过 three-mmd 运行时覆盖 morph、IK、append transform、SDEF/QDEF、toon/sphere 材质及 Ammo 物理。这些检查不声明跨格式人形重定向能复现 MMD 摄像机、灯光、音频、MME 效果或模型专用非人形控制语义。

## 有意排除

未收集 `MMD-Blender/blender_mmd_tools` 的 Miku/Luka 样例，以及 Three.js 相关仓库复制的 Miku PMD/VMD 示例。它们自身的样例声明指出 Piapro 角色/非商业或其他资产专用条款，因此不能把仓库级 GPL/MIT 标签当成这些角色二进制可无限制使用的许可证。
