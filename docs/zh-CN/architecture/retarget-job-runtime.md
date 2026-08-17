# 重定向任务运行时

> 本文是 [English](../../architecture/retarget-job-runtime.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

浏览器本地处理仍将上传文件视为不受信任输入。任务运行时会校验格式范围、安全整数运算和可序列化协议结构，但不再施加产品特定的资源策略。

## Worker 边界

`src/workers/retarget.worker.ts` 每个 Worker 运行一个隔离任务。浏览器客户端在取消或达到调用方配置的截止时间时终止该 Worker，因此取消会真正停止 CPU 工作，而不只是忽略过期回调。请求和结果使用结构化消息，包含任务 ID、进度阶段、错误码及可转移的 `ArrayBuffer` 负载。

有界浏览器输入准备使用独立的 `src/workers/input-preparation.worker.ts` 入口。重定向 Worker 只接受重定向协议任务，不能再把输入准备请求路由进求解器/importer 图。

`runRetargetJob()` 默认使用 `bufferOwnership: "copy"`：先克隆任务，只转移
Worker 拥有的副本，调用方缓冲区不会 detached。受信任且追求吞吐的调用方可显式选择
`"transfer"`，并接受其输入缓冲区立即失效。transfer list 会递归收集并按缓冲区身份
去重；成功、失败、取消、超时、克隆异常、`messageerror` 与进度回调异常统一进入同一
Worker 清理路径。

重定向消息使用协议 schema version `1`。双方都会校验版本、task/response 判别字段、
已注册格式 ID、有界核心字段、进度值、已注册错误码和对应 task 的成功结果。未知 task
或格式会 fail-closed，绝不会落入另一 importer、exporter 或验证分支。

活动 Worker 路由为：

```text
二进制 BVH / VMD / VRMA / GLB 导入 -> 解析 -> 规范化
可序列化规范片段 + 目标骨架 -> 求解 -> 优化
规范片段 -> 动作导出
导出字节 -> 结构重载 -> 语义比较
```

包含包内相对资源的文本 glTF 留在主线程，因为其包 URL 注册表归文档所有。专用 Mixamo 求解器也留在主线程，因为 Three.js 场景图和 `AnimationMixer` 无法安全结构化克隆；在分配采样数组前仍会校验生成数量是否发生安全整数溢出。角色创作继续走现有格式专用路径；输出为内存字节数组时，其独立重载和语义验证在 Worker 中运行。

## 安全校验与可选策略

库不再使用默认的文件大小、时长、FPS、采样数量、估算内存、输出字节或处理时间上限拒绝任务。这些阈值随设备和产品变化，并且没有真实失败证据支持。

`src/processing-budget.ts` 继续集中处理格式安全的有限数值、安全整数乘法和调用方显式限制。调用方可以选择 `deadlineMs`，或配置平台特定的 Node/浏览器限制；正的安全整数不会被库收紧。

`heightScale`、`armOffsetDegrees` 和 `playbackSpeed` 仍必须为有限值并位于语义范围。VMD/BVH 导出器在分配输出前继续计算展开数量，使整数溢出或调用方显式限制能够确定性失败。Worker 隔离、取消、结构化失败与资源清理仍是强制要求。

预览调度、摄像机、WebGL 生命周期和表现均属消费端职责。它们可以消费规范结果或已验证的 SDK 结果，但不得定义解析器、求解器、验证或导出行为。
