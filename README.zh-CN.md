# 3dretarget

> 本文是 [English](README.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

`3dretarget` 是从 `3dretarget-online` 抽离的独立动作重定向引擎。它负责格式探测、源数据规范化、规范动作、骨架检查、目标求解、验证、导出、处理预算，以及可取消的浏览器 Worker 运行时。

在 API 与打包后的 Worker 契约稳定之前，本包保持私有。`3dretarget-online` 目前尚未消费本包。

## 归属边界

- 本仓库负责可复用的重定向行为及其证明语料。
- Web 路由、React 状态、预览表现、市场发布、本地化、分析和部署仍归 `3dretarget-online` 所有。
- `3d-core` 属于独立的模型格式/Scene IR 领域。只有语义相符时才可复用；格式名称相似本身并不构成集成契约。

## 开发

```powershell
pnpm install
pnpm verify
```

大型研究语料下载到被 Git 忽略的 `references/` 目录。已提交的固定资源均包含来源和哈希记录。

## 公开入口

- `3dretarget`
- `3dretarget/browser`
- `3dretarget/io`
- `3dretarget/node`
- `3dretarget/validation`
- `3dretarget/certification`

在本仓库通过独立稳定性门禁前，消费端安装和同步均明确延后。

迁移清单和当前归属矩阵见 `docs/zh-CN/handoff-inventory.md`。
