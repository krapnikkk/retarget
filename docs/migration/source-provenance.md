# Extraction provenance

[简体中文](../zh-CN/migration/source-provenance.md)

- Source repository: `C:\Workspace\Coding\3dretarget-online`
- Source commit: `cd043312021f66f0a2af916457bfd2a613b10ec4`
- Extraction date: 2026-08-14
- Target repository: `C:\Workspace\Coding\3dretarget`

The initial extraction copied reusable retargeting source, domain tests, pinned
fixtures, corpus fetchers, and normative architecture documents. It excluded
React components, Next/Vinext behavior, preview presentation, SEO, market
publishing, Cloudflare operations, and release orchestration.

The Golden Motion fixtures were copied into an SDK-owned fixture path so engine
certification no longer depends on the web product's release catalog lock.

## Path map

| Source area | Target area | Disposition |
|---|---|---|
| `src/lib/{adapters,certification,export,formats,import,jobs,mmd,parsers,pipelines,profiles,resources,retarget,rig-motion,rigs,solvers,validation}` | matching directories under `src/` | reusable engine implementation |
| loader, rig, semantic, and track helpers in `src/lib/browser/` | `src/browser/` | browser SDK adapters only |
| preview scenes, themes, frame scheduling, WebGL presentation, download UI, and placeholder rendering in `src/lib/browser/` | not copied | consumer presentation |
| `src/workers/retarget.worker.ts` | `src/workers/retarget.worker.ts` | isolated runtime entry |
| public-asset license policy | `src/licensing/open-license.ts` | narrowed to the two SDK fixture licenses; catalog policy removed |
| reusable domain tests and fixtures | `tests/` | moved with the behavior and evidence they prove |
| corpus and certification scripts | `scripts/` | network fetch and offline verification kept separate |
| normative and research engine documents | `docs/` | copied and now maintained as an English/Chinese pair |

`src/index.ts`, `src/browser/index.ts`, `src/io.ts`, `src/node.ts`, and the
validation/certification entry modules are standalone package surfaces created
for this repository. They do not expose consumer UI or market modules.
