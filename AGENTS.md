# Project purpose

`3dretarget` is the sole intended owner of reusable animation-retargeting logic.
It is being stabilized independently before any web consumer installs it.

## Correctness boundaries

- Keep `Source -> Canonical -> Target` explicit. Importers normalize source
  evidence; exporters must not reinterpret the source or bind to another rig.
- File names and extensions are hints. Importers require bounded content probes.
- Treat files as untrusted. Preserve byte/processing budgets, cancellation,
  Worker isolation, and structured public error codes.
- Parsing, solving, validation, and export must not depend on React, Next.js,
  product routes, localization, market catalogs, or preview scenes.
- A certification case requires structural reload, semantic comparison, and
  pinned ecosystem evidence. Generated hashes and locks are separate changes.

## Package boundaries

- Public entries are intentionally coarse. Do not export internal files merely
  to avoid designing a stable contract.
- Root and Worker messages must remain serializable. Keep `File` and DOM helpers
  in browser-facing adapters; do not expose Three.js scene objects from core APIs.
- Tests and reproducible corpus manifests move with the behavior they prove.
  Large downloaded corpora stay ignored and never enter the package tarball.
- Do not add `3dretarget-online` as a dependency or modify that consumer until an
  explicit stabilization and integration task is approved.
