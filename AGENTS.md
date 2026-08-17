# Project purpose

[简体中文](AGENTS.zh-CN.md)

`3dretarget` is a consumer-neutral library and the sole owner of reusable
animation-retargeting behavior. It evolves independently of any application,
deployment, or downstream release cycle.

## Correctness boundaries

- Keep `Source -> Canonical -> Target` explicit. Importers normalize source
  evidence; exporters must not reinterpret the source or bind to another rig.
- File names and extensions are hints. Importers require bounded content probes.
- Treat files as untrusted. Preserve format-safety bounds, archive-bomb
  protection, cancellation, Worker isolation, and structured public error
  codes. Product-specific file-size, elapsed-time, and memory policies belong
  to consumers and require observed evidence before entering library defaults.
- Parsing, solving, validation, and export must not depend on product UI,
  application state, routes, localization, catalogs, or preview scenes.
- A certification case requires structural reload, semantic comparison, and
  pinned ecosystem evidence. Generated hashes and locks are separate changes.

## Package boundaries

- Public entries are intentionally coarse. Do not export internal files merely
  to avoid designing a stable contract.
- Root and Worker messages must remain serializable. Keep `File` and DOM helpers
  in browser-facing adapters; do not expose Three.js scene objects from core APIs.
- Tests and reproducible corpus manifests live with the behavior they prove.
  Large downloaded corpora stay ignored and never enter the package tarball.
- Consumer repositories are not dependencies, release gates, or synchronization
  targets. Do not modify them as part of library work.
- Accept downstream requests only when they can be expressed as reusable
  capabilities with stable contracts, legal fixtures, and independent evidence.
