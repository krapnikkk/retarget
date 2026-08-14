# 开放模型资产

> 本文是 [English](../open-model-assets.md) 的中文同步版。许可证判断和法律含义只以英文原文及上游条款为准。

本地文件收集在 `references/open-models/`。`references/` 被 Git 忽略，因此这些资产仅用于本地人工测试、导入导出检查和固定资源探索，不用于随仓库分发。

## 许可证规则

- CC0/公有领域资产可不署名使用。
- CC BY 4.0 资产可使用、修改、商业再分发和销售，但面向用户的演示、已发布截图、视频和再分发包必须保留署名及许可证链接。
- 自定义许可证下的免费资产可用于本地测试，但再分发原模型或动作文件前必须审查相应许可证。
- 移动资产时，保持每个已下载 `*.README.md` 与源文件相邻。

## Khronos glTF Sample Models

来源：<https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0>

| 文件 | 许可证 | 格式 | 用途 |
|---|---|---|---|
| `references/open-models/khronos-gltf-sample-models/SimpleSkin.gltf` | CC0/公有领域 | glTF | 骨架和关节处理的最小蒙皮固定资源 |
| `references/open-models/khronos-gltf-sample-models/SimpleMorph.gltf` | CC0/公有领域 | glTF | 最小 morph target 固定资源 |
| `references/open-models/khronos-gltf-sample-models/AnimatedMorphSphere.glb` | CC0/公有领域 | GLB | morph 动画导入及播放检查 |
| `references/open-models/khronos-gltf-sample-models/InterpolationTest.glb` | CC0/公有领域 | GLB | 动画插值兼容检查 |
| `references/open-models/khronos-gltf-sample-models/CesiumMan.glb` | CC BY 4.0 | GLB | 人形动画角色样例；公开演示前还需审查 Cesium 商标条款 |
| `references/open-models/khronos-gltf-sample-models/RiggedFigure.glb` | CC BY 4.0 | GLB | 骨架导入检查的简单绑定角色 |
| `references/open-models/khronos-gltf-sample-models/RiggedSimple.glb` | CC BY 4.0 | GLB | 快速骨架导入检查的小型样例 |
| `references/open-models/khronos-gltf-sample-models/Fox.glb` | 混合：模型 CC0，绑定/动画 CC BY 4.0 | GLB | 多片段动画绑定样例；非人形但可测试动画播放 |

下载 README 中的署名说明：

- CesiumMan：由 Cesium 捐赠用于 glTF 测试，采用 CC BY 4.0 International。
- RiggedFigure/RiggedSimple：由 Cesium 捐赠用于 glTF 测试，采用 CC BY 4.0 International。
- Fox：PixelMannen 的低模狐狸为 CC0；Sketchfab 上 @tomkranis 的绑定和动画为 CC BY 4.0；glTF 转换由 @AsoboStudio 与 @scurest 完成。

## Poly Haven

来源：<https://polyhaven.com/a/wooden_table_02>

Poly Haven 资产以 CC0 发布。该桌子不是人形资产，但提供小型 FBX/glTF 文件，可做加载器冒烟和材质/纹理路径验证。

| 文件 | 许可证 | 格式 | 用途 |
|---|---|---|---|
| `references/open-models/polyhaven-wooden-table-02/gltf/wooden_table_02_1k.gltf` | CC0 | glTF | 带纹理 glTF 加载测试 |
| `references/open-models/polyhaven-wooden-table-02/fbx/wooden_table_02_1k.fbx` | CC0 | FBX | 通用 FBX 加载冒烟 |

glTF 文件依赖：

- `references/open-models/polyhaven-wooden-table-02/gltf/wooden_table_02.bin`
- `references/open-models/polyhaven-wooden-table-02/gltf/textures/wooden_table_02_diff_1k.jpg`
- `references/open-models/polyhaven-wooden-table-02/gltf/textures/wooden_table_02_nor_gl_1k.jpg`
- `references/open-models/polyhaven-wooden-table-02/gltf/textures/wooden_table_02_arm_1k.jpg`

## VRM 样例

来源：<https://github.com/madjin/vrm-samples>

| 文件 | 许可证 | 格式 | 用途 |
|---|---|---|---|
| `references/open-models/madjin-vrm-samples/vroid/fem_vroid.vrm` | VRoid 样例 README 声明相关样例组为 CC0 | VRM | 女性 VRM 角色导入和重定向目标测试 |
| `references/open-models/madjin-vrm-samples/vroid/masc_vroid.vrm` | VRoid 样例 README 声明相关样例组为 CC0 | VRM | 男性 VRM 角色导入和重定向目标测试 |
| `references/open-models/madjin-vrm-samples/Seed-san/vrm/Seed-san.vrm` | VRM Public License 1.0 | VRM | 具有 VRM 专用许可证条款的免费角色 |

许可证说明：

- 与 VRoid 样例一起保留 `references/open-models/madjin-vrm-samples/README.md`。它链接官方 VRoid Studio 样例模型条款，并区分 CC0 模型和具有特殊使用条件的模型。
- 与 Seed-san 一起保留 `references/open-models/madjin-vrm-samples/Seed-san/README.md`。它标明该模型是 VirtualCast, Inc. 的 Seed-san，采用 VRM Public License 1.0。

## MMD PMX/VMD

来源：<https://github.com/mmdagent-ex/gene>

| 文件 | 许可证 | 格式 | 用途 |
|---|---|---|---|
| `references/mmd/research-corpus/mmdagent-gene/Gene_light.pmx` | CC BY 4.0，另含商标/设计使用说明 | PMX | PMX 导入测试的轻量 MMD 角色 |
| `references/mmd/research-corpus/mmdagent-gene/motion/00_normal.vmd` | CC BY 4.0，另含仓库使用指引 | VMD | 小型表情/对话动作固定资源 |
| `references/mmd/research-corpus/mmdagent-gene/motion/stand.vmd` | CC BY 4.0，另含仓库使用指引 | VMD | 基础站立动作固定资源 |

轻量 PMX 依赖 `references/mmd/research-corpus/mmdagent-gene/light/` 下 PNG。通过 `pnpm fetch:mmd-research-corpus` 和 `pnpm check:mmd-research-corpus` 生成并验证锁定提交的语料，不维护第二份本地副本。

Gene README 要求的署名：

```text
CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society
```

README 还说明权利人保留商标和设计权。学术及个人非商业商标/设计使用获得许可；其他商业用途应联系维护者。

## BVH 动作

来源：<https://github.com/una-dinosauria/cmu-mocap>

| 文件 | 许可证/使用条款 | 格式 | 用途 |
|---|---|---|---|
| `references/open-models/cmu-mocap-bvh/01_14.bvh` | CMU 对原始数据不设限制；Bruce Hahne 对 BVH 转换不增加限制 | BVH | 适合 MotionBuilder、首帧 T-pose 的 CMU BVH 样例 |

与 BVH 一起保留 `references/open-models/cmu-mocap-bvh/READMEFIRST.txt`，其中包含 CMU 署名请求和转换说明。相关权利段声明原始数据可在全球研究和商业项目中免费使用，BVH 转换不增加限制。

## Mixamo

Mixamo 资产可通过 Adobe/Mixamo 免费使用，但并非 CC0、CC BY 4.0 或开放模型资产。除非 GitHub 镜像具有权利人授予的独立再分发许可，否则不要从随机镜像下载 Mixamo 文件。

推荐本地流程：

1. 登录 <https://www.mixamo.com/>。
2. 下载小型角色或动作 FBX 做本地人工测试。
3. 存到 `references/open-models/mixamo-local/`。
4. 除非 Adobe 当前条款明确允许，否则不要提交或再分发原始 Mixamo FBX。

## 格式覆盖

已收集：

- GLB/glTF 动画、蒙皮、morph、插值及绑定样例。
- FBX 加载器冒烟样例。
- VRM 角色样例。
- PMX 角色及 VMD 动作样例。
- BVH 人形动作样例。

未收集：

- VRMA：本轮没有加入许可证清晰的小型 VRMA 样例。
- Mixamo FBX：虽可通过 Adobe/Mixamo 免费使用，但原始资产再分发条款并非开放模型风格，因此未收集。
