# 公开重定向错误码注册表

> 本文是 [English](../../architecture/error-code-registry.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

权威类型和英文兜底消息位于 `src/retarget/errors.ts`。UI 翻译可以增加操作指引，但必须保留稳定错误码，以供支持和遥测使用。

| 代码 | 边界 | 含义/下一步 |
|---|---|---|
| `VRM_PARSE_FAILED` | 导入 | 无法解析 VRM/glTF 容器；验证文件或包。 |
| `VRM_MISSING_HUMANOID_BONE` | 导入 | 缺少必需的 VRM 人形骨骼绑定；修复角色骨架。 |
| `FBX_PARSE_FAILED` | 导入 | FBX 加载器拒绝文件；检查二进制/ASCII 完整性。 |
| `FBX_NOT_MIXAMO` | 探测/导入 | 已选择 Mixamo，但骨骼证据不匹配；改用通用 FBX 或显式映射。 |
| `FBX_NO_ANIMATION` | 导入 | 未找到可用的 FBX 动画栈。 |
| `FBX_ANIMATION_SELECTION_REQUIRED` | 导入 | FBX 包含多个动作或重名动作，必须提供显式索引或唯一名称。 |
| `FBX_ANIMATION_NOT_FOUND` | 导入 | 请求的 FBX 动作索引/名称不存在，或两个选择器互相冲突。 |
| `VRMA_PARSE_FAILED` | 导入 | VRMA 或其必需扩展数据无效。 |
| `BVH_PARSE_FAILED` | 导入 | BVH 层级或动作采样无效。 |
| `VMD_PARSE_FAILED` | 导入 | VMD 头部/骨骼动作无效或不受支持。 |
| `GLTF_ANIMATION_PARSE_FAILED` | 导入 | glTF 动画通道或访问器无效。 |
| `UNSUPPORTED_FORMAT` | 探测/路由 | 没有基于证据的适配器支持所选输入或流程。 |
| `WEBGL_UNAVAILABLE` | 预览 | 浏览器无法创建所需 WebGL 上下文；处理仍可能继续。 |
| `FILE_TOO_LARGE` | 字节预算 | 输入或可传输资源在读取前已超过字节上限。 |
| `PACKAGE_INVALID` | 包 | ZIP/包路径、展开内容、依赖或入口不安全/无效。 |
| `RETARGET_FAILED` | 求解/绑定 | 源到目标求解或目标局部绑定失败。 |
| `EXPORT_FAILED` | 导出/验证 | 序列化或导出后验证失败。 |
| `PARSE_*` | 解析器 | 计数、长度、数值或截断违反有界解析契约。 |
| `BVH_*`、`GLTF_*`、`VRMA_DUPLICATE_TRACK` | 格式解析 | 有界解析已定位到稳定、格式特定的违规。 |
| `PROCESSING_*` | 处理预算 | 动作结构、时长、FPS、选项、期限或输出工作量超过限制。 |
| `WORKER_UNAVAILABLE` | 平台隔离 | 所需浏览器或 Node Worker 不可用；公开隔离路径不会改为内联执行。 |
| `WORKER_PROTOCOL_INVALID` | Worker 边界 | 请求或响应未通过协议版本、判别字段、字段或结果校验。 |
| `RETARGET_JOB_FAILED` | Worker | 未知错误跨越 Worker 边界，且没有更具体的已注册错误码。 |
| `TARGET_RIG_IDENTITY_MISSING` | 目标绑定/导出 | 角色导出收到未求解或缺少目标骨架身份的旧动作。 |
| `TARGET_RIG_INVALID` | 目标绑定/导出 | 目标静止姿态证据无效或包含非有限数值。 |
| `TARGET_RIG_MISMATCH` | 目标绑定/导出 | 提供的角色并非已求解动作记录的目标骨架。 |
| `TARGET_MAPPING_EMPTY` | 求解 | 没有源动作轨道映射到所选目标；应修复骨架/profile 映射。 |
| `TARGET_MAPPING_INSUFFICIENT` | 求解 | 求解轨道超出了声明的目标骨骼集合；必须拒绝结果。 |
| `TARGET_REQUIRED_CHAIN_MISSING` | 求解 | 所选 preset 既未映射 hips，也未覆盖其目标链中的必需骨骼。 |
| `ARTIFACT_INVALID` | Node 资源验证 | 输入字节未通过格式重载、骨架检查或语义验证。 |
| `ARTIFACT_AUTHORING_FAILED` | Node 资源生成 | 生成过程未能产出通过必需重载检查的资源。 |
| `OPERATION_CANCELLED` | 隔离执行 | 调用方取消了正在执行的 Worker 操作。 |

新增错误码必须包含类型化条目、本地化呈现、边界明确的抛出位置和至少一项回归测试。公开消息绝不能暴露原始解析栈、本机路径、上传字节或密钥。

解析与处理错误统一继承公开的 `RetargetError`。Worker 序列化只保留本注册表中的错误码；任意字符串会收敛为 `RETARGET_JOB_FAILED`。
