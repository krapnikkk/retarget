# 抽离来源

> 本文是 [English](../../migration/source-provenance.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

- 源仓库：`C:\Workspace\Coding\3dretarget-online`
- 源提交：`cd043312021f66f0a2af916457bfd2a613b10ec4`
- 抽离日期：2026-08-14
- 目标仓库：`C:\Workspace\Coding\3dretarget`

初次抽离复制了可复用的重定向源码、领域测试、锁定固定资源、语料拉取脚本和规范性架构文档。React 组件、Next/Vinext 行为、预览表现、SEO、市场发布、Cloudflare 运维和发布编排均被排除。

Golden Motion 固定资源被复制到 SDK 自有路径，因此引擎认证不再依赖 Web 产品的发布目录锁。

## 路径映射

| 源区域 | 目标区域 | 处理方式 |
|---|---|---|
| `src/lib/{adapters,certification,export,formats,import,jobs,mmd,parsers,pipelines,profiles,resources,retarget,rig-motion,rigs,solvers,validation}` | `src/` 下同名目录 | 可复用引擎实现 |
| `src/lib/browser/` 中加载器、骨架、语义和轨道辅助逻辑 | `src/browser/` | 仅浏览器 SDK 适配器 |
| `src/lib/browser/` 中预览场景、主题、帧调度、WebGL 表现、下载 UI 和占位渲染 | 未复制 | 消费端表现 |
| `src/workers/retarget.worker.ts` | 同路径 | 隔离运行时入口 |
| 公共资产许可证政策 | `src/licensing/open-license.ts` | 收窄为两个 SDK 固定资源许可证；移除目录政策 |
| 可复用领域测试和固定资源 | `tests/` | 与其证明的行为和证据一起迁移 |
| 语料和认证脚本 | `scripts/` | 网络拉取与离线验证保持分离 |
| 规范和研究型引擎文档 | `docs/` | 已复制，现以中英文配对维护 |

`src/index.ts`、`src/browser/index.ts`、`src/io.ts`、`src/node.ts` 以及 validation/certification 入口是本仓库新建的独立包表面，不暴露消费端 UI 或市场模块。
