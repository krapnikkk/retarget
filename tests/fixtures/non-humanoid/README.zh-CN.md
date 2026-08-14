# 非人形固定资源清单

> 本文是 [English](README.md) 的中文同步版。若中英文在法律、安全、治理或规范性要求上存在冲突，以英文版为准。

`mesh2motion/` 包含来自官方 [Mesh2Motion 应用仓库](https://github.com/Mesh2Motion/mesh2motion-app) 的锁定验收固定资源。上游 `LICENSE-CC0.MD` 声明所有 3D 模型、骨架和动画均以 CC0 1.0 贡献。每个文件的精确上游提交、源路径和 SHA-256 记录在 `mesh2motion/provenance.json`。

运行 `pnpm fetch:mesh2motion-fixtures` 可从锁定上游提交复现固定资源；运行 `pnpm check:mesh2motion-fixtures` 可离线验证已提交文件。

这些文件是测试证据，不是公共目录条目。目录准入仍需独立的清单、预览、完整性锁及认证记录。

| 固定资源用例 | 源 | 验收内容 |
|---|---|---|
| 四足动作矩阵 | `fox-animations.glb` | Idle、Walk、Run、Jump |
| 四足比例 | `fox-base.glb`、`fox-dog.glb`、`fox-horse.glb` | 同签名及跨比例重定向 |
| 鸟类 | `bird-animations.glb`、`bird-eagle.glb` | 翅膀、腿、尾巴 |
| 蛇形 | `snake-animations.glb` | 可变轴向链重采样，包括生成的 8 关节目标 |
| 蛛形 | `spider-animations.glb` | 八条编号放射状肢体及缩放静止目标 |
| 龙/生物 | `dragon-animations.glb` | 身体、四肢、翅膀、尾巴及缩放静止目标 |
| 无骨架边界 | `snake-target.glb`、`spider-target.glb`、`dragon-target.glb` | 求解前拒绝，因为只有网格并不构成骨架 |
