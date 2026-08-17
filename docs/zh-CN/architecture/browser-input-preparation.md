# 浏览器输入准备

[English source](../../architecture/browser-input-preparation.md)

`3dretarget/browser/input` 通过 `prepareBrowserAssetInput()` 提供宿主文件获取与库内不可信输入准备之间的粗粒度边界；`3dretarget/browser` 为兼容性重新导出同一 API。之所以提供仅输入入口，是因为生产打包证据表明完整浏览器入口还会携带重定向流水线与格式专用运行时。两个入口都不负责文件选择器 UI，也不会持久化浏览器权限。

## 所有权边界

宿主负责用户手势，并取得 `File`、可读文件句柄或可读目录句柄。宿主交付该值后，库负责安全遍历、ZIP 展开、主文件选择、路径规范化、sidecar 解析、适配器选择、Worker 隔离与资源释放。

返回结果属于浏览器入口：它包含 `File` 和显式 `dispose()` 方法。根入口、IO、校验与认证入口仍不公开 `File` 或 DOM 契约。

## 内容优先选择

文件扩展名只提供低置信度提示。输入准备 Worker 检查有界内容窗口，并返回包含下列字段的 `selection`：

- `status`：`matched`、`inconclusive` 或 `unsupported`；
- 可确定时返回稳定的角色、格式 ID、profile ID 与容器；
- 结构化证据码、警告、置信度与 `bytesInspected`。

`inconclusive` 表示有界证据不足以识别受支持输入；`unsupported` 表示内容已经识别出已知容器，但该容器不支持请求的角色。改名后的有效输入仍可通过签名匹配，而误导性的受支持扩展名本身不能形成匹配。

ZIP 与目录中的主文件选择遵循相同规则。存在零个或多个内容验证通过的主文件时会拒绝输入，不会根据文件名猜测。

## 安全限制与调用方策略

稳定策略字段如下：

| 字段 | 含义 |
| --- | --- |
| `maxProbeBytes` | 用于选择输入的有界证据窗口总量 |
| `maxEntries` | 可选的最多遍历或归档条目数 |
| `maxCompressedBytes` | 最大压缩包或输入字节数 |
| `maxExpandedBytes` | 最大展开总字节数 |
| `maxSingleEntryBytes` | 单个保留条目的最大字节数 |
| `maxRetainedBytes` | 保留的 Blob 包资源最大总字节数 |
| `maxElapsedMs` | 调用方可选的输入准备 Worker 截止时间 |

只有 `maxProbeBytes` 具有通用默认值。库不再设置产品特定的文件大小、保留字节、目录条目数或处理时间上限；其他字段均为可选的调用方策略，正的安全整数不会被收紧。畸形的显式调用方限制以 `PROCESSING_OPTION_INVALID` 失败，并在读取大块内容或解压前检查。内容探测仍保持有界。ZIP 输入独立保留归档炸弹防护默认值，包括条目数量、单条目及总展开字节数和压缩比，并继续校验路径与声明范围。

## Worker 与进度

浏览器输入准备运行在打包后的专用 `dist/workers/input-preparation.worker.js` 中。该 Worker 只包含隔离的发现、有界探测、归档/资源包处理与 transferable 构造，不与重定向求解器或格式解析器运行时图共享边界；重定向 Worker 仍是独立的操作边界。

输入准备消息使用 schema version `2`。双方都会校验请求/响应判别字段、任务 ID、角色、限制、进度、已注册错误码与成功结果结构。畸形消息以 `WORKER_PROTOCOL_INVALID` fail-closed；创建失败使用 `WORKER_UNAVAILABLE`，不可信输入准备绝不静默退回主线程。`AbortSignal`、调用方配置的截止时间、`messageerror`、克隆异常与进度回调异常统一终止活动 Worker，并进入同一清理路径。

包门禁会把 tarball 安装到临时消费端，用生产 bundler 构建 `3dretarget/browser/input`，并检查输出代码和源码模块证据。入口及其 Worker 必须排除 MMD、VMD、Ammo、FBX loader 和完整重定向任务标记。入口、Worker、tarball 与消费端 bundle 的字节数只作为诊断信息输出，不再作为硬门禁。

进度使用专用阶段联合：

```text
discover | read | probe | unpack | resolve | complete
```

消费方根据阶段标识进行本地化，不解析进度消息。执行顺序取决于输入形态：归档必须先展开，才能探测其中的主文件。

## 资源生命周期

准备后的包保留 Blob 支撑的条目，使现有加载器能够解析相对 sidecar。`collectTransferable()` 创建后续 Worker 作业使用的可序列化资源载荷。`dispose()` 释放包上下文、可重复调用，并阻止后续再次收集 transferable。

## 公共示例

```ts
import { prepareBrowserAssetInput } from "3dretarget/browser";

const prepared = await prepareBrowserAssetInput(file, {
  role: "motion",
  signal,
  onProgress({ phase }) {
    updateLocalizedProgress(phase);
  },
});

try {
  if (prepared.selection.status !== "matched") {
    showInputRecovery(prepared.selection);
    return;
  }
  await usePreparedFile(prepared.file);
} finally {
  prepared.dispose();
}
```

基于范围读取的 Animated GLB 导出与角色—动作配对归档属于独立能力。消费端对等验证和删除下游重复代码不是本契约的验收门禁。
