# @krapnikkk/retarget

[English](https://github.com/krapnikkk/retarget/blob/main/README.md)

`@krapnikkk/retarget` 是一个不依赖特定消费端的 TypeScript 动画重定向库，可对不可信的 3D 文件进行有界内容探测，并明确遵循 `Source -> Canonical -> Target` 流程。它通过可取消的浏览器 Worker 运行时和 Node 工具层，提供源数据规范化、骨架检查、目标求解、语义验证和导出能力。

## 安装

```sh
npm install @krapnikkk/retarget
```

## 环境要求

- 仅支持 ESM，不支持 CommonJS。
- `@krapnikkk/retarget/node` 和 `@krapnikkk/retarget/io` 要求 Node >= 24.11.0。
- 浏览器必须支持模块 Worker。
- 打包工具须支持 `new Worker(new URL("...", import.meta.url), { type: "module" })`，例如 Vite、webpack 5 或配有 Worker 插件的 Rollup。

## 公开入口

| 入口 | 用途 |
| --- | --- |
| `@krapnikkk/retarget` | 可序列化的格式、Profile、动作、骨架、流水线和错误契约。 |
| `@krapnikkk/retarget/browser` | 内容优先的有界 File/资源包准备、显式资源释放，以及无 Worker 即失败的隔离执行。 |
| `@krapnikkk/retarget/browser/input` | 仅包含输入准备，避免在主包中引入重定向流水线或格式解析器运行时。 |
| `@krapnikkk/retarget/io` | 不暴露 DOM 或场景对象的字节级动作导入导出。 |
| `@krapnikkk/retarget/node` | 字节级 IO、隔离式确定性 VRM/PMX 与 Rig Motion glTF 生成/验证任务，以及仅供受信任场景使用的显式内联重定向任务；不公开文件系统遍历或通用 ZIP API。 |
| `@krapnikkk/retarget/validation` | 可序列化的语义验证结果。 |
| `@krapnikkk/retarget/certification` | 来源和保证等级清单。 |

## 快速开始

在 Worker 中探测用户选择的动作文件。选择流水线前，应检查探测结果的状态和格式；使用后务必释放准备阶段持有的资源。

```ts
import { prepareBrowserAssetInput } from "@krapnikkk/retarget/browser/input";

export async function inspectMotion(file: File, signal?: AbortSignal) {
  const prepared = await prepareBrowserAssetInput(file, { role: "motion", signal });
  try {
    return prepared.selection;
  } finally {
    prepared.dispose();
  }
}
```

对于已识别为 BVH 的文件，通过浏览器 Worker 导入规范动作。可传入 AbortSignal 取消任务。

```ts
import { runRetargetJob } from "@krapnikkk/retarget/browser";

export async function importMotion(file: File, signal?: AbortSignal) {
  return runRetargetJob(
    {
      type: "import-motion",
      formatId: "bvh",
      filename: file.name,
      bytes: await file.arrayBuffer(),
    },
    { signal },
  );
}
```

Node 工具可通过 IO 入口直接导入 BVH 字节：

```ts
import { importBVH } from "@krapnikkk/retarget/io";

export function importMotionBytes(bytes: Uint8Array) {
  const motion = importBVH(bytes, "walk.bvh");
  return { duration: motion.duration, tracks: motion.tracks };
}
```

## 支持的组合与保证等级

保证等级按具体用例划分：`experimental` 能力仅供评估；`beta` 组合具有声明范围内的固定资源和 Profile 证据；`certified` 用例还具有结构重载、语义比较和固定版本的生态兼容证据。1.0 之前，API 可能在次版本升级时发生变化。

公开人形流水线注册表现有九个完整 beta 组合：`gltf-animation` 到 `gltf-humanoid` 可输出 `animated-glb`、`fbx-animation`、`vrma`、`gltf-animation` 或 `motion-json`；`vrma` 到 `gltf-humanoid` 可输出 `animated-glb`；`gltf-animation`、`bvh` 或 `vmd` 到 `vrm` 可输出 `baked-vrm`。查询必须同时提供三个格式 ID，`pipeline.run(...)` 返回声明的输出字节和已求解动作。其中固定的 Golden `gltf-animation -> gltf-humanoid -> animated-glb` 用例另有仅适用于该用例的 Blender 与 Godot 认证证据。

浏览器入口还公开 `runRiggedGLTFPipeline`，用于非人形 rigged glTF 配对。其 beta 范围覆盖五个固定 Mesh2Motion family 的 Animated GLB 矩阵：Fox 四足（12 个动作/目标配对）、Bird/Eagle（4）、Snake（7）、Spider（9）和 Dragon（4）。这 36 个配对只保证固定资源和 profile，不泛化为任意 rigged glTF 配对。

## 错误与安全

公开接口的失败使用[错误码注册表](https://github.com/krapnikkk/retarget/blob/main/docs/zh-CN/architecture/error-code-registry.md)中的结构化错误码。浏览器输入准备和 Worker 任务支持通过 AbortSignal 取消。应始终将文件视为不可信输入：文件名仅是提示，内容探测有明确边界，解析和归档处理保留格式安全限制。产品专属的文件大小、耗时和内存策略由消费端负责。

## 文档

- [文档地图](https://github.com/krapnikkk/retarget/blob/main/docs/zh-CN/README.md)
- [公开 API 契约](https://github.com/krapnikkk/retarget/blob/main/docs/zh-CN/architecture/public-api-contract.md)
- [浏览器输入准备](https://github.com/krapnikkk/retarget/blob/main/docs/zh-CN/architecture/browser-input-preparation.md)
- [Node 资源工具层](https://github.com/krapnikkk/retarget/blob/main/docs/zh-CN/architecture/node-artifact-tooling.md)
- [功能库稳定性门禁](https://github.com/krapnikkk/retarget/blob/main/docs/zh-CN/stabilization-gates.md)
- [供应链与发布流程](https://github.com/krapnikkk/retarget/blob/main/docs/zh-CN/supply-chain-security.md)
- [安全政策](https://github.com/krapnikkk/retarget/blob/main/SECURITY.zh-CN.md)

## 开发

```sh
pnpm install
pnpm hooks:install # 每个工作副本执行一次
pnpm check        # 架构规则、类型检查、unit 测试（pre-commit）
pnpm test:slow    # CPU 密集的真实资源测试
pnpm verify       # 完整发布门禁，prepublishOnly 也会执行
pnpm verify:ecosystem # 需要固定版本的 Blender 和 Godot
```

纳入版本控制的 pre-commit hook 会运行 `pnpm check`。`pnpm verify` 额外执行覆盖率、认证回执、固定资源和包验证。大型研究语料保存在由 Git 忽略的 `references/` 中；已提交的固定资源包含来源与哈希记录。

## 许可证

[MIT](https://github.com/krapnikkk/retarget/blob/main/LICENSE)。许可证覆盖本库代码，不会重新许可用户资源、输入、输出或独立安装的依赖。详见[第三方声明](https://github.com/krapnikkk/retarget/blob/main/THIRD_PARTY_NOTICES.md)。
