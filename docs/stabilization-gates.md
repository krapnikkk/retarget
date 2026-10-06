# Library stability gates

[简体中文](zh-CN/stabilization-gates.md)

The maintenance gates for the public npm package measure the library
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
4. **Passed locally:** committed fixtures, Golden Motion, structural reload,
   semantic comparison, and the pinned Blender 5.2.0 LTS / Godot 4.7.1 receipt
   pass independently for the first certified pipeline. Unity is deferred and
   is not required or claimed by the current local certification profile.
5. **Passed locally:** package size and browser/Worker entries have measured,
   enforced baselines. The public high-level import, target inspection, and
   solve path executes through the Worker.

All current library stability gates pass locally. Individual capabilities may
remain experimental while their own evidence is incomplete. Stable or certified
status depends only on the applicable library-owned gates; it must not depend on
a particular consumer build or deployment.
