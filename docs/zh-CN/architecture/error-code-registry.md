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
| `VRMA_PARSE_FAILED` | 导入 | VRMA 或其必需扩展数据无效。 |
| `BVH_PARSE_FAILED` | 导入 | BVH 层级或动作采样无效。 |
| `VMD_PARSE_FAILED` | 导入 | VMD 头部/骨骼动作无效或不受支持。 |
| `GLTF_ANIMATION_PARSE_FAILED` | 导入 | glTF 动画通道或访问器无效。 |
| `UNSUPPORTED_FORMAT` | 探测/路由 | 没有基于证据的适配器支持所选输入或流程。 |
| `WEBGL_UNAVAILABLE` | 预览 | 浏览器无法创建所需 WebGL 上下文；处理仍可能继续。 |
| `FILE_TOO_LARGE` | 预算 | 输入、采样、帧、期限或输出超出共享处理限制。 |
| `PACKAGE_INVALID` | 包 | ZIP/包路径、展开内容、依赖或入口不安全/无效。 |
| `RETARGET_FAILED` | 求解/绑定 | 源到目标求解或目标局部绑定失败。 |
| `EXPORT_FAILED` | 导出/验证 | 序列化或导出后验证失败。 |

新增错误码必须包含类型化条目、本地化呈现、边界明确的抛出位置和至少一项回归测试。公开消息绝不能暴露原始解析栈、本机路径、上传字节或密钥。
