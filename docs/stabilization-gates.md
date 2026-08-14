# Library stability gates

[简体中文](zh-CN/stabilization-gates.md)

The current maintenance profile is local-only. These gates measure the library
using commands, packed artifacts, fixtures, and runtime evidence contained in
this repository. Publication and consumer integration are separate activities
and do not determine library readiness.

1. **Passed locally:** public entry names and serializable request/result
   contracts have completed an API review. See
   `architecture/public-api-contract.md`.
2. **Passed locally:** the packed browser entry resolves its Worker from the
   installed tarball and the bundled Worker completes a request/result runtime
   smoke test.
3. **Passed locally:** browser execution does not silently fall back to
   CPU-heavy inline work for untrusted uploads. Inline execution for Node or
   tests is an explicit API.
4. **Partial:** committed fixtures, Golden Motion, structural reload, and
   semantic comparison pass independently. Named external ecosystem receipts
   remain pending and no case is promoted to `certified` without them.
5. **Passed locally:** package size and browser/Worker entries have measured,
   enforced baselines. The public high-level import, target inspection, and
   solve path executes through the Worker.

A capability may remain experimental while its evidence is incomplete. Stable
or certified status depends only on the applicable library-owned gates; it must
not depend on a particular consumer build or deployment.
