# 3dretarget

> 本文是 [English](README.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

`3dretarget` 是一个消费者中立的动作重定向功能库，提供有界格式探测、源数据规范化、规范动作、骨架检查、目标求解、语义验证、导出、处理预算、可取消的浏览器 Worker 运行时，以及隔离式 Node 资源工具层。

`0.1.0` 版本以本地打包的受控预览版形式分发。包在注册表元数据中继续保持私有，以防止意外发布到注册表；下游安装并精确锁定所提供的 tarball。项目路线图和就绪状态由可复用的重定向能力决定，不以任何特定应用为中心。

## 范围

本仓库负责：

- 可复用的 `Source -> Canonical -> Target` 行为；
- 可序列化的公开契约和平台适配器；
- 正确性、安全性、资源预算及兼容性证据；
- 可复现固定资源和认证清单。

本仓库不负责产品 UI、应用状态、目录、分析、托管或部署。消费端专属的集成代码和验收测试由消费应用自行负责。

## 开发

```powershell
pnpm install
pnpm verify
pnpm verify:ecosystem # 需要固定版本的 Blender 与 Godot
```

大型研究语料下载到被 Git 忽略的 `references/` 目录。已提交的固定资源均包含来源和哈希记录。

## 本地受控发布

安装维护者提供的不可变 `0.1.0` tarball：

```powershell
pnpm add C:\path\to\3dretarget-0.1.0.tgz
```

消费端必须精确锁定包版本，并且只使用已记录的公开入口。包版本 `0.1.0` 表示 API 仍处于初始开发阶段；能力保证继续按精确用例标记为 `experimental`、`beta` 或 `certified`。实验路径可用于评估，但不作为生产兼容组合提供支持。受支持的 Node 工具链以 `package.json` 声明为准。

MIT 许可证覆盖本库代码，但不会重新许可消费端资源、用户输入、生成输出或独立安装的依赖。

## 公开入口

- `3dretarget`：可序列化的格式、Profile、动作、骨架、流水线和错误契约。
- `3dretarget/browser`：内容优先的有界 `File`/资源包准备、显式资源释放，以及无 Worker 即失败的隔离执行。
- `3dretarget/io`：不暴露 DOM 或场景对象的字节级动作导入导出。
- `3dretarget/node`：字节级 IO、隔离式确定性 VRM/PMX 与 Rig Motion glTF 生成/验证任务，以及仅供受信任场景使用的显式 inline retarget job；不公开文件系统遍历或通用 ZIP API。
- `3dretarget/validation`：可序列化的语义验证结果。
- `3dretarget/certification`：来源和保证等级清单。

公开人形流水线注册表现有九个完整 beta 组合：`gltf-animation` 到 `gltf-humanoid` 可输出 `animated-glb`、`fbx-animation`、`vrma`、`gltf-animation` 或 `motion-json`；`vrma` 到 `gltf-humanoid` 可输出 `animated-glb`；`gltf-animation`、`bvh` 或 `vmd` 到 `vrm` 可输出 `baked-vrm`。查询必须同时提供三个格式 ID，`pipeline.run(...)` 返回声明的输出字节和已求解动作。其中固定的 Golden `gltf-animation -> gltf-humanoid -> animated-glb` 用例另有仅适用于该用例的 Blender 与 Godot 认证证据。

浏览器入口还公开 `runRiggedGLTFPipeline`，用于非人形 rigged glTF 配对。其 beta 范围覆盖五个固定 Mesh2Motion family 的 Animated GLB 矩阵：Fox 四足（12 个动作/目标配对）、Bird/Eagle（4）、Snake（7）、Spider（9）和 Dragon（4）。这 36 个配对只保证固定资源和 profile，不泛化为任意 rigged glTF 配对。

当前本地就绪标准见[功能库稳定性门禁](docs/zh-CN/stabilization-gates.md)。
