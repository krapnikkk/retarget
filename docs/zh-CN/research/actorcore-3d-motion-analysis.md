# ActorCore 3D Motion 分析

> 本文是 [English](../../research/actorcore-3d-motion-analysis.md) 的中文同步版。本文是非规范性研究快照，产品与条款可能变化；冲突时以英文版和上游当前资料为准。

## 概览

[ActorCore 3D Motion](https://actorcore.reallusion.com/3d-motion) 是 Reallusion 的商业 3D 动作资产平台。其核心并非 Mixamo 式自动角色绑定，而是面向生产的动捕动作、动作包、已绑定角色，以及针对具体软件的下载/重定向流程。

产品形态更接近：

```txt
专业动作资产商店 -> 在线预览 -> 平台专用下载 -> 在 DCC/游戏引擎中重定向
```

而不是：

```txt
上传模型 -> 自动绑定 -> 应用动画
```

资料：

- [ActorCore](https://actorcore.reallusion.com/)
- [ActorCore 3D Motion](https://actorcore.reallusion.com/3d-motion)
- [ActorCore 角色动画技术](https://actorcore.reallusion.com/3d-character-animation-technology)
- [ActorCore FAQ](https://actorcore.reallusion.com/learn-and-support/faq/content)
- [Unreal 流程](https://actorcore.reallusion.com/learn-and-support/my-software/unreal)
- [Blender 流程](https://actorcore.reallusion.com/learn-and-support/my-software/blender/step-by-step-guide/your-own-character)
- [CG Channel 报道](https://www.cgchannel.com/2022/01/download-28-free-mocap-moves-from-actorcore/)

## 产品定位

ActorCore 面向需要较高质量、可用于生产的人形动作的创作者，覆盖游戏、影视动画、建筑可视化、数字孪生、工业仿真、iClone/Character Creator，以及 Unity、Unreal、Blender、Maya、3ds Max、MotionBuilder、Cinema 4D 和 Omniverse 用户。产品中心是获取和使用动作资产，而非从零创建骨架。

## 主流程

```txt
搜索/浏览动作目录
-> 在线预览
-> 购买或领取免费资产
-> 选择目标应用/下载预设
-> 导入 DCC 或游戏引擎
-> 重定向到项目角色
```

Mixamo 从用户角色上传和自动绑定开始；ActorCore 从寻找高质量动作或动作包开始。

## 内容模型

ActorCore 将动作组织为单项资产和主题包。公开可见类别包括建筑施工、购物、跑酷、儿童行为、交谈/聆听、BMX、空中格斗、日常生活、战斗、奇幻和中世纪动作。该分类很重要：平台出售的是场景覆盖，而不只是孤立 walk/run/idle 片段。

## 质量主张

ActorCore 的定位比 Mixamo 更高端，强调专业动捕、生产型动作包、更好的脚底接触、减少滑步、部分资产的手指/脚趾动画、支持内容的表情和眼球运动，以及某些动作集附带的道具/配件。技术页还强调动态表情、眼球运动和情境感知，以形成更自然的角色表现。

## 格式与平台支持

其实际优势是平台专用交付，覆盖 Unreal、Unity、Blender、Maya、3ds Max、MotionBuilder、Cinema 4D、iClone 和 Omniverse。生态以 FBX 为中心，部分页面和索引资产也提到 BVH、USD；第三方报道指出主要 DCC 和游戏引擎都有导出/下载预设。因此 ActorCore 不仅是动作库，也是管线产品。

## 重定向模型

ActorCore 并不主要在浏览器中完成重定向，而是提供可下载资产和工具专用指引，让用户在目标软件中完成。例如 Unreal、Blender、Maya、3ds Max 的流程页，以及面向目标应用的预设下载。它假设用户会在 DCC 或引擎中完成最终集成，这与浏览器重定向器的产品决策不同。

## 产品边界

ActorCore 动作主要面向双足人形角色。官方 FAQ 搜索结果说明其动作针对 biped humanoid，不推荐四足角色。

- 不是通用生物动画系统；
- 不是 VRM/VRMA 优先工具；
- 不是纯浏览器重定向/导出产品；
- 不以自动绑定为主；
- 最终质量会受目标软件、骨架预设和导入设置影响。

## 与 Mixamo 比较

| 维度 | Mixamo | ActorCore 3D Motion |
|---|---|---|
| 主要产品 | 自动绑定加免费动作库 | 商业动捕动作商店 |
| 主入口 | 上传/选择人形角色 | 搜索、预览、购买/下载动作 |
| 目标用户 | 快速原型和低门槛动画 | 需要高质量动作的生产用户 |
| 动作组织 | 可搜索单个片段 | 主题包和场景库 |
| 重定向模型 | Mixamo 骨架和可下载动画 | 平台预设及外部重定向流程 |
| 格式生态 | 常见 3D 导出，尤其 FBX | 以 FBX 为中心，含广泛 DCC/引擎预设及部分 BVH/USD |
| VRM/VRMA | 非一等支持 | 非一等支持 |

Mixamo 更适合作为大众入口；ActorCore 更适合作为专业动作来源。

## 优势与弱点

优势：强商业动作目录、场景化动作包、比 Mixamo 更贴合生产管线、平台专用流程、与 iClone/Character Creator 深度整合、覆盖多类生产场景，并有免费区降低试用门槛。

弱点：非 VRM/VRMA 原生、非浏览器原生转换、依赖外部工具和导入预设、不适合只需一键 Web 转换的用户、主要聚焦双足人形，且商业资产市场的复杂度远高于聚焦型转换工具。

## 对 3dretarget-online 的意义

ActorCore 应被视为未来输入来源，而不是首个要复制的产品：

```txt
ActorCore FBX/BVH/USD 动作 -> 浏览器重定向适配器 -> VRM 预览 -> VRMA 导出
```

这可补充当前 Mixamo 优先路径：

```txt
Mixamo FBX -> 浏览器重定向 -> VRM 预览 -> VRMA 导出
```

它也证明高质量人形动作具有商业价值，但资产商店与转换/重定向工具是完全不同的业务。

## 产品经验与建议定位

可借鉴：按用户场景而非技术片段名组织动作；格式有差异时提供目标应用预设；把预览质量作为选购核心；把动作包当成流程而非孤立文件；按平台记录重定向步骤。

MVP 不应复制：广泛市场范围、核心浏览器重定向器稳定前的多 DCC 集成、付费资产运营、以动捕库规模竞争。

当前最合适的定位是“`3dretarget-online` 未来可能支持的专业动作来源”。项目先聚焦：

```txt
VRM + Mixamo FBX -> VRMA
```

之后再扩展为：

```txt
VRM + humanoid FBX presets -> VRMA
```

ActorCore 可与 Mixamo 等动作库一起，成为更广泛人形 FBX 管线中的一个预设家族。
