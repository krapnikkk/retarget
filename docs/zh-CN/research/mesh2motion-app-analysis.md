# mesh2motion-app 分析

> 本文是 [English](../../research/mesh2motion-app-analysis.md) 的中文同步版。本文是非规范性研究快照，冲突时以英文版为准。

## 概览

`references/mesh2motion-app` 是一个开源浏览器工具，用于为 3D 模型添加骨架和动画。产品形态类似 Mixamo，但扩展性更强：支持多个内置骨架家族，并包含实验性动画重定向流程。

主流程：

```txt
上传 3D 模型
-> 选择骨架类型
-> 编辑骨架位置
-> 计算蒙皮权重
-> 预览动画库
-> 导出 GLB/GLTF
```

项目另有一个独立重定向模式，用于在已有骨架的模型之间应用动画。

## 技术栈

- Vite、TypeScript、Three.js、Vitest
- JSZip、file-saver、tippy.js

重要文件：

- `references/mesh2motion-app/package.json`
- `references/mesh2motion-app/vite.config.js`
- `references/mesh2motion-app/src/Mesh2MotionEngine.ts`
- `references/mesh2motion-app/src/RigConfig.ts`
- `references/mesh2motion-app/src/retarget/AnimationRetargetService.ts`

Vite 有三个页面入口：`src/index.html`（探索/营销预览）、`src/create.html`（自定义模型主流程）、`src/retarget/index.html`（实验性已绑定模型重定向）。

## 主架构

中心运行时类 `Mesh2MotionEngine` 负责 Three.js 场景、摄像机、渲染器、变换控制器、事件监听器、UI 引用和流程步骤。主流程拆成以下 step 类：

- `StepLoadModel`：加载 GLB/GLTF/FBX 及 ZIP 打包模型资产。
- `StepLoadSkeleton`：加载所选预设骨架。
- `StepEditSkeleton`：支持骨架编辑、镜像、撤销/重做、变换控制和拖拽放置骨骼。
- `StepWeightSkin`：生成蒙皮网格及 skin index/weight 属性。
- `StepAnimationsListing`：加载和筛选动画库，预览片段并选择导出。
- `StepExportToFile`：通过 Three.js `GLTFExporter` 导出选定蒙皮网格和片段。

分阶段管线很清晰，但实现仍与 DOM 状态、Three.js 场景状态和近似单例的 UI 管理器紧密耦合。

## 支持的骨架家族

配置集中在 `RigConfig.ts`，支持 Human、Fox、Bird、Dragon、Kaiju、Spider、Snake、Fish。每个配置定义默认模型、骨架 GLB、显示名、动画文件、动画预览目录、骨架参考图、位置跟踪骨骼和可选模型变体。

`static` 包含大量模型、骨架、动画 GLB、预览 MP4、参考图、图标和测试文件。因此该项目既是代码库，也是捆绑资产库。

## 自动蒙皮

自动蒙皮采用启发式算法，而非机器学习。核心类包括 `SkinningAlgorithm`、`WeightCalculator`、`WeightSmoother`、`WeightNormalizer`、`HeadWeightCorrector`、`BoneClassifier`。

```txt
骨骼层级 + 网格几何
-> 初始顶点到骨骼权重分配
-> 感知类别的边界平滑
-> 权重归一化
-> 可选头部权重修正
-> 创建 SkinnedMesh
```

`WeightSmoother` 对躯干、肢体和其他边界使用不同平滑策略。若所有边界都做通用 50/50 混合，肘、膝、髋和躯干过渡会产生较差变形。

## 重定向模块

该模块与主自动蒙皮流程分离。核心文件：

- `src/retarget/retarget.ts`
- `src/retarget/AnimationRetargetService.ts`
- `src/retarget/steps/StepLoadSourceSkeleton.ts`
- `src/retarget/steps/StepLoadTargetModel.ts`
- `src/retarget/steps/StepBoneMapping.ts`
- `src/retarget/steps/StepExportRetargetedAnimations.ts`
- `src/retarget/bone-automap/BoneAutoMapper.ts`
- `src/retarget/human-retargeting/Retargeter.ts`
- `src/retarget/human-retargeting/HumanChainConfig.ts`

流程：

```txt
加载源骨架
-> 加载目标已绑定模型
-> 映射源骨骼到目标骨骼
-> 重定向所选动画
-> 导出重定向片段
```

骨骼映射支持直接 Mixamo、直接 Rigify、Mesh2Motion、自定义拖放，以及基于类别/名称的自动映射。

## 人形 Swing/Twist 重定向

对通用重定向产品最有技术价值的是人形 swing/twist 求解器。它不只是重命名轨道，而是构建源/目标骨架，求值源动画，并计算可对齐解剖方向的目标骨骼旋转。

```txt
源世界旋转
-> 提取源 swing 与 twist 方向
-> 根据当前姿势和 T-pose 计算目标中性变换
-> 将目标 swing 方向旋向源 swing
-> 将目标 twist 方向旋向源 twist
-> 把结果转回目标局部空间
-> 写入目标姿势
```

特殊处理包括：按比例传递 pelvis/root 平移；spine 可使用末端插值；不完整链回退到更简单的逐链行为；输出烘焙为 Three.js 关键帧轨道。这比简单骨骼名映射更接近真实骨架到骨架重定向。

## 测试状态

测试面较窄，现有说明显示主要聚焦重定向骨骼类别映射。已覆盖 torso、arm、hand、leg、wing/tail/unknown 映射，以及空数组、大小写、特殊字符边界。

覆盖较弱或缺失：模型导入边界、自动蒙皮质量、GLB 导出正确性、完整浏览器流程、动画重定向质量、Three.js 场景生命周期。

## 优势

- 清晰的分阶段流程和集中骨架配置。
- 大型内置骨架/动画资产库及实用浏览器 GLB 导出。
- 有价值的自动蒙皮启发式算法。
- 超越轨道改名的真实重定向概念。
- 骨骼自动映射和人形 swing/twist 等模块对未来通用系统有复用价值。

## 弱点

- UI、DOM、Three.js 场景状态和处理类紧密耦合。
- 相对算法复杂度而言测试有限。
- 仓库资产很重，产品中的重定向模块仍标为实验性。
- 导出和重定向可能高度依赖骨骼命名、姿势假设和模型比例。
- 非人形通用性在自动蒙皮流程中强于重定向流程。

## 相关架构证据

需要在本库独立验证的候选思路：分阶段流程、集中骨架配置、自动骨骼映射、骨架链配置、swing/twist 求解器、GLB 导出及格式无关的固定资源组织。

必须保持的边界：不复制大型 DOM 绑定流程类，不把大型资产库打进包，也不在一个 API 中同时解决自动绑定、蒙皮、重定向、预览和导出。

`mesh2motion-app` 仅作为架构参考，不是本库的依赖、兼容目标或公开契约来源。
