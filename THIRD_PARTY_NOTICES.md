# Third-party notices

`@krapnik/retarget` depends on the following separately distributed runtime packages:

| Package | Version range | Declared license |
| --- | ---: | --- |
| `@gltf-transform/core` | ^4.3.0 | MIT |
| `@moeru/three-mmd` | ^0.1.1 | MIT |
| `gltf-transform-vrm-extensions` | ^0.1.6 | MIT |
| `three` | ^0.184.0 | MIT |

The production dependency graph reported by pnpm also contains MIT-licensed
transitive packages and `@dimforge/rapier3d-compat` 0.12.0 under Apache-2.0
through the `@types/three` peer dependency graph.

Dependency implementations are not copied into the `@krapnik/retarget` bundle; the
published JavaScript retains external package imports. Each installed
dependency remains governed by the license and notices distributed with that
dependency. This summary does not replace those authoritative license files.
