# Node 资源工具层

[English](../../architecture/node-artifact-tooling.md)

`3dretarget/node` 将 `runNodeToolJob` 作为粗粒度 Node 资源生成与验证边界。运行器启动打包后的 Node tooling Worker，且不会回退到进程内执行。`AbortSignal` 或调用方可选的截止时间会终止 Worker，即使同步解析器或写入器仍在运行也能取消。

## 契约

任务只接收 `ArrayBuffer` 与可序列化元数据。结果是带稳定 `RetargetErrorCode`、阶段进度及结构化诊断的成功/失败判别联合。公开声明不会暴露 `File`、文件系统路径、Three.js 对象、glTF-Transform `Document` 或原始 ZIP helper。

首批任务覆盖：

- rigged glTF 检查与 Rig Motion v2 导入；
- 确定性 Rig Motion glTF 导出，以及结构和语义重载验证；
- 确定性 canonical GLB 到 VRM 生成；
- 确定性 canonical GLB 到 PMX 或完整 PMX bundle 生成；由于腿部 IK、物理和 morph 生成仍不在范围内，该能力保持 experimental；
- VRM、PMX、PMX bundle 与 Rig Motion glTF 字节验证。

格式能力表继续由根包公开，来源与保证清单继续位于 `3dretarget/certification`。Node 入口不会复制目录或认证策略。

## 确定性

资源名称、canonical 输入字节、元数据、选项和 Rig Motion `createdAt` 均为显式输入。写入器不会读取时钟或本机路径。PMX bundle 写入器使用固定 ZIP 元数据和规范条目顺序。每个生成资源都会返回名称、字节长度、媒体类型、保证等级、SHA-256、字节和分层验证报告。

结构、语义和生态证据保持分离。没有动作的角色资源将语义验证报告为 `not-applicable`；除非另行评估固定的外部回执，否则生态证据为 `not-run`。

## 所有权

功能库负责生成语义、格式安全边界、骨架检查、验证和诊断。消费端负责目录遍历、文件系统写入、目录 schema、slug、发布标志、署名策略、锁文件布局、清理和发布。通用 ZIP 创建/读取保持内部，仅由格式专属 bundle 操作使用。

Node 任务默认不设置文件大小、输出大小、估算内存或处理时间上限。`RunNodeToolJobOptions.budget` 保留为消费端可选策略；正值会被校验，但不会收紧到库拥有的上限。ZIP 条目数量、展开字节数与压缩比防护继续生效。

输入默认复制到 Worker。确定不会复用输入缓冲区的调用方可以设置
`bufferOwnership: "transfer"`；只有任务声明的字节字段会被转移并 detached。

```ts
import { runNodeToolJob } from "3dretarget/node";

const result = await runNodeToolJob({
  type: "author-vrm",
  artifactName: "avatar.vrm",
  canonicalGLBBytes,
  metadata: {
    name: "Avatar",
    author: "Example author",
    license: "CC0-1.0",
  },
});

if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
await writeArtifact(result.result.artifact);
```
