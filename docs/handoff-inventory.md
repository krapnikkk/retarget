# Engine extraction handoff inventory

[简体中文](zh-CN/handoff-inventory.md)

This inventory records what was handed from `3dretarget-online` to the
standalone `3dretarget` repository. It is the ownership map for stabilization,
not an instruction to cut the consumer over.

## Traceability

- Source repository: `C:\Workspace\Coding\3dretarget-online`
- Source commit: `cd043312021f66f0a2af916457bfd2a613b10ec4`
- Initial standalone commit: `094ee94487b485258879677fe370becf64f371b4`
- Detailed path provenance: `migration/source-provenance.md`

## Handed to this repository

| Area | Contents | Proof kept with it |
|---|---|---|
| Core pipeline | format probes, import normalization, canonical motion, rig inspection, solving, validation, export | unit and integration tests |
| Runtime | processing budgets, cancellation, serializable job protocol, browser Worker entry | Worker-path tests and packed-entry verification |
| Format families | VRM/VRMA, FBX, BVH, glTF animation, MMD, non-humanoid rig definitions | parser tests, semantic tests, public error codes |
| Certification | structural reload, semantic comparison, ecosystem evidence contracts | certification tests and generated lock |
| Reproducible evidence | small committed fixtures, pinned provenance, hashes, corpus fetch/check scripts | offline fixture checks and ignored large corpora |
| Engine documentation | architecture decisions, normative contracts, checklists, compatibility matrices, research evidence | this English tree and its Chinese mirror |

## Intentionally left in the web application

- Next.js/Vinext routes, React state, UI components, page layout, and preview
  presentation.
- SEO, localization strings, analytics, content, market/catalog publishing, and
  Cloudflare deployment.
- Product orchestration that turns SDK results into user-visible workflows.
- Consumer-specific release and operational documentation.

Preview code may consume canonical results, but no parsing, solving,
validation, certification, or export module may depend on a React component or
browser scene.

## Temporary duplication and cutover state

The source repository still contains its current engine implementation. That
duplication is deliberate until the standalone API and packed Worker contract
pass `stabilization-gates.md`. There is no bidirectional sync script: fixes are
reviewed and ported intentionally so ownership does not become ambiguous.

`3dretarget-online` currently has no `3dretarget` package dependency and must not
install one during this stabilization phase. A later, explicit integration task
must pin a release, replace consumer imports, run both repositories' gates, and
record rollback evidence before the duplicate implementation can be removed.

## Items not translated or packaged

- Generated JSON locks remain language-neutral and are not duplicated.
- Third-party license texts remain verbatim; translations could change legal
  meaning and are not authoritative.
- Downloaded research corpora remain ignored and never enter the package tarball.

## Handoff acceptance

The initial repository handoff is complete when all of these remain true:

1. `pnpm verify` passes independently in this repository.
2. Package verification finds only the six declared public entries and no test,
   research-corpus, or web-product files in the tarball.
3. Every committed fixture has reproducible provenance and integrity evidence.
4. Every normative English document has a Chinese counterpart, while English
   remains authoritative for legal, security, governance, and normative conflicts.
5. The consumer repository stays dependency-free until a separately approved
   cutover.
