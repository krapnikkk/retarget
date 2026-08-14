# ActorCore 3D Motion Analysis

[简体中文](../zh-CN/research/actorcore-3d-motion-analysis.md)

## Overview

[ActorCore 3D Motion](https://actorcore.reallusion.com/3d-motion) is Reallusion's commercial 3D motion asset platform. Its core product is not automatic character rigging like Mixamo, but a catalog of production-oriented mocap motions, motion packs, rigged characters, and software-specific download/retarget workflows.

The product shape is closer to:

```txt
professional motion asset store
-> online preview
-> platform-specific download
-> retarget in DCC/game engine
```

rather than:

```txt
upload model
-> auto-rig
-> apply animation
```

Sources:

- [ActorCore](https://actorcore.reallusion.com/)
- [ActorCore 3D Motion](https://actorcore.reallusion.com/3d-motion)
- [Advanced 3D Character Animation Technology - ActorCore](https://actorcore.reallusion.com/3d-character-animation-technology)
- [ActorCore FAQ](https://actorcore.reallusion.com/learn-and-support/faq/content)
- [ActorCore Unreal workflow](https://actorcore.reallusion.com/learn-and-support/my-software/unreal)
- [ActorCore Blender workflow](https://actorcore.reallusion.com/learn-and-support/my-software/blender/step-by-step-guide/your-own-character)
- [CG Channel: Download free mocap moves and rigged characters](https://www.cgchannel.com/2022/01/download-28-free-mocap-moves-from-actorcore/)

## Product Positioning

ActorCore is a 3D motion and character asset store for creators who need higher-quality, production-ready humanoid motion.

It targets:

- game developers
- film and animation teams
- architectural visualization teams
- digital twin and industrial simulation creators
- iClone and Character Creator users
- Unity, Unreal, Blender, Maya, 3ds Max, MotionBuilder, Cinema 4D, and Omniverse users

The product is built around acquiring and using motion assets, not creating a new rig from scratch.

## Main Workflow

The typical ActorCore motion workflow is:

```txt
search or browse motion catalog
-> preview motion online
-> buy or claim free asset
-> choose target application/download preset
-> import into DCC or game engine
-> retarget to project character
```

This is different from Mixamo. Mixamo's key flow begins with user character upload and auto-rigging. ActorCore begins with finding a high-quality motion or motion pack.

## Content Model

ActorCore organizes motions as individual assets and themed packs.

Examples visible through search/indexed pages include:

- construction industry motions
- shopping
- parkour
- kids' acts
- talk and listen
- BMX
- aerial fighter
- daily life
- combat
- fantasy and medieval actions

This category structure matters. ActorCore sells motion as scenario coverage, not just isolated walk/run/idle clips.

## Quality Claims

ActorCore's motion positioning is more premium than Mixamo's.

Its quality claims include:

- professional mocap
- production-oriented motion packs
- better foot-ground contact
- reduced sliding
- finger and toe animation in some assets
- facial expressions and eye movement in supported content
- associated props/accessories for some motion sets

The technology page also emphasizes animated facial expressions, eye movement, and situational awareness for more natural character performance.

## Formats And Platform Support

ActorCore's practical strength is platform-specific delivery.

Its support ecosystem includes workflows for:

- Unreal Engine
- Unity
- Blender
- Maya
- 3ds Max
- MotionBuilder
- Cinema 4D
- iClone
- Omniverse

The ecosystem is centered on FBX, with some pages and indexed asset descriptions also referencing BVH and USD. Third-party reporting notes export/download presets for major DCC tools and game engines.

This means ActorCore is not just a motion library; it is also a pipeline product.

## Retargeting Model

ActorCore does not mainly solve retargeting inside the browser. Instead, it provides downloadable assets and tool-specific guidance so users can retarget inside their target software.

Examples:

- Unreal retarget workflow pages.
- Blender retarget workflow pages.
- Maya and 3ds Max workflow pages.
- Preset-oriented downloads intended to match a target application.

This is a different product decision from a browser retargeter. ActorCore assumes the user will complete final integration in a DCC or engine.

## Product Boundaries

ActorCore motions are primarily designed for biped humanoid avatars. The official FAQ search result states that ActorCore motions are designed for biped humanoid avatars and are not recommended for quadruped avatars.

Important boundaries:

- not a general creature animation system
- not a VRM/VRMA-first tool
- not a browser-only retarget/export product
- not primarily an auto-rigger
- final retarget quality can depend on target software, rig preset, and import settings

## Comparison With Mixamo

| Dimension | Mixamo | ActorCore 3D Motion |
| --- | --- | --- |
| Primary product | Auto-rigging plus free motion library | Commercial mocap motion asset store |
| Main entry point | Upload or choose humanoid character | Search, preview, buy/download motion |
| Target user | Fast prototyping and low-friction animation | Production users needing higher-quality motion |
| Motion organization | Individual searchable clips | Themed packs and scenario libraries |
| Retarget model | Mixamo skeleton and downloadable animation | Platform-specific presets and external retarget workflows |
| Format ecosystem | Common 3D exports, especially FBX | FBX-centered, with broader DCC/engine presets and some BVH/USD references |
| VRM/VRMA support | Not first-class | Not first-class |

Mixamo is better as a mass-market entry point. ActorCore is better as a professional motion source.

## Strengths

- Strong commercial motion catalog.
- Scenario-based motion packs.
- Better fit for production pipelines than Mixamo.
- Platform-specific workflows.
- Clear Reallusion ecosystem integration with iClone and Character Creator.
- Useful for games, film, archviz, simulation, and digital twin work.
- Free asset area lowers trial friction.

## Weaknesses

- Not VRM/VRMA-native.
- Not a browser-native conversion workflow.
- Retargeting depends on external tools and import presets.
- Less useful for users who only want a one-click web conversion.
- Mainly humanoid/biped focused.
- Commercial asset marketplace complexity is much larger than a focused conversion tool.

## Relevance To 3dretarget-online

ActorCore should be understood as a future input source, not as the first product to clone.

For `3dretarget-online`, ActorCore suggests a later product expansion:

```txt
ActorCore FBX/BVH/USD motion
-> browser retarget adapter
-> VRM preview
-> VRMA export
```

This complements the current Mixamo-first MVP:

```txt
Mixamo FBX
-> browser retarget
-> VRM preview
-> VRMA export
```

ActorCore also validates that high-quality humanoid motion has commercial value. But building an asset store is a very different business from building a conversion/retargeting tool.

## Product Lessons

Lessons worth borrowing:

- organize motion around user scenarios, not only technical clip names
- support target-application presets when formats vary
- make preview quality central to asset selection
- treat motion packs as workflows, not isolated files
- document retarget workflows per platform

Lessons not to copy in the MVP:

- broad marketplace scope
- multi-DCC integration before the core browser retargeter is stable
- paid asset operations
- trying to compete on mocap library size

## Recommended Positioning

For the current project, ActorCore is best positioned as:

```txt
a professional motion source that 3dretarget-online may support later
```

The current project should continue to focus on:

```txt
VRM + Mixamo FBX -> VRMA
```

Then later expand toward:

```txt
VRM + humanoid FBX presets -> VRMA
```

ActorCore can become one preset family in that broader humanoid FBX pipeline, alongside Mixamo and other motion libraries.
