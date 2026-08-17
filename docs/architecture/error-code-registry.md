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
| `FBX_ANIMATION_SELECTION_REQUIRED` | import | Multiple or duplicate-named FBX actions require an explicit index or unique name. |
| `FBX_ANIMATION_NOT_FOUND` | import | The requested FBX action index/name is absent or conflicts with the other selector. |
| `VRMA_PARSE_FAILED` | import | VRMA or its required extension data is invalid. |
| `BVH_PARSE_FAILED` | import | BVH hierarchy or motion samples are invalid. |
| `VMD_PARSE_FAILED` | import | VMD header/body motion is invalid or unsupported. |
| `GLTF_ANIMATION_PARSE_FAILED` | import | glTF animation channels or accessors are invalid. |
| `UNSUPPORTED_FORMAT` | probe/routing | No evidence-backed adapter supports the selected input/workflow. |
| `WEBGL_UNAVAILABLE` | preview | Browser cannot create the required WebGL context; processing may still be possible. |
| `FILE_TOO_LARGE` | configured byte policy | An input or transferable resource exceeds an explicit caller limit or an archive-safety bound. |
| `PACKAGE_INVALID` | package | ZIP/package paths, expansion, dependencies, or entrypoint are unsafe/invalid. |
| `RETARGET_FAILED` | solve/bind | Source-to-target solve or target-local binding failed. |
| `EXPORT_FAILED` | export/validate | Serialization or post-export validation failed. |
| `PARSE_*` | parser | Counts, lengths, numbers, or truncation violate format safety or an explicit caller limit. |
| `BVH_*`, `GLTF_*`, `VRMA_DUPLICATE_TRACK` | parser domain | Parsing identified a stable format-specific violation. |
| `PROCESSING_*` | processing safety/policy | Clip shape or options are invalid, generated arithmetic is unsafe, or work exceeds an explicit caller deadline/limit. |
| `WORKER_UNAVAILABLE` | platform isolation | The required browser or Node Worker is unavailable; isolated public paths do not run the job inline. |
| `WORKER_PROTOCOL_INVALID` | Worker boundary | A request or response failed protocol version, discriminator, field, or result validation. |
| `RETARGET_JOB_FAILED` | Worker | An unexpected failure crossed the Worker boundary without a more specific registered code. |
| `TARGET_RIG_IDENTITY_MISSING` | target bind/export | Avatar export received an unsolved or legacy clip without target-rig identity. |
| `TARGET_RIG_INVALID` | target bind/export | Target rest-pose evidence is invalid or non-finite. |
| `TARGET_RIG_MISMATCH` | target bind/export | The supplied avatar is not the rig recorded by the solved motion. |
| `TARGET_MAPPING_EMPTY` | solve | No source tracks map to the selected target; fix the rig/profile mapping. |
| `TARGET_MAPPING_INSUFFICIENT` | solve | Solved tracks escaped the declared target-bone set; reject the result. |
| `TARGET_REQUIRED_CHAIN_MISSING` | solve | The selected preset maps neither hips nor a required bone in one of its target chains. |
| `ARTIFACT_INVALID` | Node artifact validation | Supplied bytes failed format reload, rig inspection, or semantic validation. |
| `ARTIFACT_AUTHORING_FAILED` | Node authoring | Authoring completed insufficiently to produce an artifact that passes its required reload checks. |
| `OPERATION_CANCELLED` | isolated execution | The caller cancelled an in-flight Worker operation. |

Additions require a typed entry, localized presentation, a boundary-specific
throw site, and at least one regression test. Never expose raw parser stacks,
local paths, uploaded bytes, or secrets in the public message.
Parser and processing errors extend the same public `RetargetError` class.
Worker serialization preserves only codes present in this registry; arbitrary
strings are reduced to `RETARGET_JOB_FAILED`.
