# Browser resource-disposal checklist

[简体中文](../zh-CN/checklists/resource-disposal.md)

- [x] Terminate Workers on success, failure, cancellation, component teardown,
      and configured deadline expiry; ignore stale job completions.
- [x] Revoke object URLs and package registries when selection changes or unmounts.
- [x] Dispose Three.js geometries, materials, textures, controls, mixers, and renderers.
- [ ] Remove window/document/canvas listeners and disconnect observers.
- [x] Cancel pending animation frames and suspend hidden/offscreen/context-lost previews.
- [ ] Reuse dynamic GPU buffers for per-frame skeleton data.
- [x] Verify rapid A -> B -> C selection, route changes, WebGL context loss/restore,
      and repeated import/export without growing live resources.
