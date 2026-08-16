# 本地公开 API 契约

[English](../../architecture/public-api-contract.md)

本审查记录 `3dretarget` 仍为私有、本地维护期间的包边界。它是稳定化兼容边界，不代表已经承诺发布到注册表。

## 入口

- `3dretarget` 仅公开可序列化的格式、配置、规范动作、骨架与结构化错误契约，不公开 `File`、DOM/Worker 句柄、Three.js 对象或 glTF-Transform 文档。
- `3dretarget/browser` 负责 `File`/`AbortSignal` 编排、窄化的高层重定向流水线与 fail-closed Worker 执行。人形流水线查询必须同时提供动作、角色和输出格式 ID，使保证等级绑定到完整输入到输出组合，而不是格式二元组。所选流水线的 `run` 方法返回声明的输出字节和已求解动作；`retarget` 保留为仅求解操作。非人形 rigged glTF 使用独立的粗粒度 `runRiggedGLTFPipeline`，在不公开 glTF-Transform 或 Three.js 对象的前提下保持完整输入到 Animated GLB 边界。
- `3dretarget/browser/input` 是稳定的仅输入准备子集。它保留相同的 `prepareBrowserAssetInput()` 契约和专用 Worker URL，但入口模块图不包含重定向流水线或格式解析器运行时。完整浏览器入口为兼容性继续重新导出该能力。
- `3dretarget/io` 只接收和返回字节与可序列化数据。
- `3dretarget/node` 公开字节 IO、用于确定性资源生成/验证的隔离式 `runNodeToolJob`，并为受信任本地工具与测试提供显式 inline retarget job。Node tooling 只接收字节和可序列化元数据，不负责文件系统遍历或目录策略；浏览器入口不导出 inline 执行。
- `3dretarget/validation` 与 `3dretarget/certification` 只公开可序列化结果和清单。

Worker task 使用判别联合消息，`RetargetJobResult<TTask>` 将每种 task 映射到对应结果类型；公开失败统一使用 `RetargetErrorCode` 注册表，可转移输入在进入解析前受到预算约束。

Avatar exporter 只接受 `TargetBoundSolvedHumanoidMotionClip`；该类型要求携带目标骨架签名，避免已求解动作被静默重新绑定到另一套骨架。

内部 parser、场景/文档对象、原始目标绑定变换、ZIP helper 和单格式 adapter 都不是公开捷径。新用例必须先形成粗粒度契约，不能为了方便直接导出内部文件。

`scripts/verify-package.mjs` 会检查声明边界、体积基线、tarball 安装与入口导入、严格 TypeScript 消费端编译、浏览器 Worker 相对 URL、带运行时/模块 deny list 的打包 browser-input 生产 bundle，以及打包重定向/Node tooling Worker 的请求/结果执行。详见 [Node 资源工具层](node-artifact-tooling.md)。
