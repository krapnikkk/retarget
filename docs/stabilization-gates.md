# Stabilization gates before consumer installation

[简体中文](zh-CN/stabilization-gates.md)

`3dretarget-online` must not install `3dretarget` merely because the initial
extraction builds. Consumer integration requires a separate approval after all
of these conditions are met:

1. Public entry names and serializable request/result contracts have completed
   an API review.
2. The packed browser entry resolves its Worker from the installed tarball and
   passes a real Vinext production-start smoke test.
3. Browser execution no longer silently falls back to CPU-heavy inline work for
   untrusted uploads. Inline execution, if retained for Node or tests, must be an
   explicit API.
4. The overlap with `3d-core` has been audited by semantic contract so generic
   format logic is neither duplicated nor coupled through provider-specific APIs.
5. Committed fixtures, optional downloaded corpora, Golden Motion, structural
   reload, semantic comparison, and ecosystem receipts all pass independently.
6. Package size and browser chunk impact have measured baselines. Heavy formats
   remain off the application main thread.
7. A temporary installation into an isolated `3dretarget-online` worktree passes
   type checking, tests, Vinext build, production-start smoke, and Cloudflare
   packaging without modifying the real consumer.
8. A cutover ADR defines versioning, rollback, source deletion, and how fixes are
   handled while the two repositories still contain temporary duplicate code.

Only after these gates pass should the web repository replace local engine
imports with the package and remove its duplicate implementation.
