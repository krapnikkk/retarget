# Public retarget error-code registry

[简体中文](../zh-CN/architecture/error-code-registry.md)

The authoritative type and English fallback messages live in
`src/retarget/errors.ts`. UI translations may add guidance but must retain
the stable code for support and telemetry.

| Code | Boundary | Meaning / next action |
| --- | --- | --- |
| `VRM_PARSE_FAILED` | import | VRM/glTF container could not be parsed; validate the file/package. |
| `VRM_MISSING_HUMANOID_BONE` | import | Required VRM humanoid bindings are absent; repair the avatar rig. |
| `FBX_PARSE_FAILED` | import | FBX loader rejected the file; verify binary/ASCII integrity. |
| `FBX_NOT_MIXAMO` | probe/import | Mixamo was selected but bone evidence does not match; use generic FBX or mapping. |
| `FBX_NO_ANIMATION` | import | No usable FBX animation stack was found. |
| `VRMA_PARSE_FAILED` | import | VRMA or its required extension data is invalid. |
| `BVH_PARSE_FAILED` | import | BVH hierarchy or motion samples are invalid. |
| `VMD_PARSE_FAILED` | import | VMD header/body motion is invalid or unsupported. |
| `GLTF_ANIMATION_PARSE_FAILED` | import | glTF animation channels or accessors are invalid. |
| `UNSUPPORTED_FORMAT` | probe/routing | No evidence-backed adapter supports the selected input/workflow. |
| `WEBGL_UNAVAILABLE` | preview | Browser cannot create the required WebGL context; processing may still be possible. |
| `FILE_TOO_LARGE` | budget | Input, samples, frames, deadline, or output exceeds a shared processing limit. |
| `PACKAGE_INVALID` | package | ZIP/package paths, expansion, dependencies, or entrypoint are unsafe/invalid. |
| `RETARGET_FAILED` | solve/bind | Source-to-target solve or target-local binding failed. |
| `EXPORT_FAILED` | export/validate | Serialization or post-export validation failed. |

Additions require a typed entry, localized presentation, a boundary-specific
throw site, and at least one regression test. Never expose raw parser stacks,
local paths, uploaded bytes, or secrets in the public message.
