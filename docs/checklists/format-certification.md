# Format certification checklist

[简体中文](../zh-CN/checklists/format-certification.md)

- [ ] Name the exact source profile, avatar profile, export format, versions,
      fixture provenance, and expected coordinate/unit/root-motion semantics.
- [ ] Run the supported public entry / Worker path, not only a registry lookup or internal function call.
- [ ] Reload the produced bytes with an independent parser and verify structure.
- [ ] Compare deterministic world-space bone rotations, hips displacement,
      hands, feet, duration, frame range, interpolation, and finite values.
- [ ] Open or import the output in the named ecosystem/version when compatibility
      is claimed; retain evidence or explicitly record `not-run`.
- [ ] Hash immutable inputs, outputs, metrics, and certification records.
- [ ] Mark assurance `certified` only while every required gate is passing;
      otherwise use `beta`, `experimental`, or unavailable truthfully.
