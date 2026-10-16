# Project purpose

[简体中文](AGENTS.zh-CN.md)

`@krapnik/retarget` is a consumer-neutral library and the sole owner of reusable
animation-retargeting behavior. It evolves independently of any application,
deployment, or downstream release cycle.

## Correctness boundaries

- Keep `Source -> Canonical -> Target` explicit. Importers normalize source
  evidence; exporters must not reinterpret the source or bind to another rig.
- File names and extensions are hints. Importers require bounded content probes.
- Treat files as untrusted. Preserve format-safety bounds, archive-bomb
  protection, cancellation, Worker isolation, and structured public error
  codes. Validate at trust boundaries (parsers, archive readers, Worker
  messages, public entries); internal calls between library modules may trust
  their typed inputs instead of re-validating them. Product-specific file-size, elapsed-time, and memory policies belong
  to consumers and require observed evidence before entering library defaults.
- Parsing, solving, validation, and export must not depend on product UI,
  application state, routes, localization, catalogs, or preview scenes.
- Only a `certified` case requires structural reload, semantic comparison, and
  pinned ecosystem evidence. Experimental and beta capabilities need structural
  and semantic tests only; do not add byte-exact hashes, receipts, or ecosystem
  runs for them. Regenerated hashes, locks, and receipts may land in the same
  commit as the change that caused them.

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

## Development workflow

The project is early-stage; keep the inner loop fast and move heavy evidence to
release time.

- `pnpm check` (architecture rule, incremental type check, `unit` tests) is
  the pre-commit gate and the default verification for a change. Run
  `pnpm test:slow` when touching binding, Mesh2Motion, Node tooling, or the
  asset CLI. `pnpm verify` is the full release gate and runs on publish.
- Test tiers are Vitest projects in `vitest.config.ts`: `unit` (default),
  `slow` (CPU-heavy real-fixture runs), and `certification` (byte-exact
  receipts and golden locks). New tests go in `unit` unless they are
  measurably slow or depend on pinned ecosystem evidence.
- Prefer tolerance-based structural and semantic assertions over byte hashes
  or exact snapshots of generated output. Determinism is proven by comparing
  two runs, not by pinning the bytes in the default tier.
- Coverage has a loose global floor. Do not add per-file ratchets.
- English documentation is normative. Chinese mirrors may lag; the
  localization check warns rather than fails.
