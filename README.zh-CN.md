# 3dretarget

> 本文是 [English](README.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

`3dretarget` 是一个消费者中立的动作重定向功能库，提供有界格式探测、源数据规范化、规范动作、骨架检查、目标求解、语义验证、导出、处理预算，以及可取消的浏览器 Worker 运行时。

本包当前保持私有并仅在本地维护，直至公开 API、正确性证据和打包后的 Worker 契约稳定。项目路线图和就绪状态由可复用的重定向能力决定，不以任何特定应用为中心。

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
```

大型研究语料下载到被 Git 忽略的 `references/` 目录。已提交的固定资源均包含来源和哈希记录。

## 公开入口

- `3dretarget`：可序列化的格式、Profile、动作、骨架、流水线和错误契约。
- `3dretarget/browser`：`File` 适配器与无 Worker 即失败的隔离执行。
- `3dretarget/io`：不暴露 DOM 或场景对象的字节级动作导入导出。
- `3dretarget/node`：显式本地内联任务与字节级 IO。
- `3dretarget/validation`：可序列化的语义验证结果。
- `3dretarget/certification`：来源和保证等级清单。

公开流水线注册表目前只暴露 beta 等级的 `gltf-animation -> gltf-humanoid`。其他已实现组合仍是实验路径，`getRetargetPipeline` 对它们返回 `null`。

当前本地就绪标准见[功能库稳定性门禁](docs/zh-CN/stabilization-gates.md)。
