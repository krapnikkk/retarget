# ADR-0001: Canonical motion is the only cross-format boundary

[简体中文](../zh-CN/architecture/ADR-0001-canonical-motion-boundary.md)

- Status: accepted
- Date: 2026-08-13

## Context

FBX, BVH, VMD, glTF, VRM, and VRMA disagree about axes, units, rest poses,
bone names, interpolation, and root motion. Passing loader-specific tracks
directly to previews or exporters lets each destination invent different
semantics and can animate an exporter-created skeleton instead of the target.

## Decision

The pipeline is `Source -> Canonical -> Target`:

1. a bounded evidence probe selects a source adapter;
2. import converts coordinates, units, aliases, time, interpolation, and
   quaternion continuity into `RetargetedMotionClip`;
3. solving samples that clip against an explicit target rest rig;
4. one target binder emits target-local tracks addressed to target object UUIDs;
5. preview and avatar export consume that same bound result;
6. standalone motion export converts canonical semantics exactly once.

No React component, preview scene, or exporter may silently redo source
normalization. Generic FBX remains an unknown-rest-pose, unknown-unit profile;
it does not inherit Mixamo assumptions from the `.fbx` extension.

## Consequences

New adapters must expose probe evidence and profile identity. New output claims
need structural reload plus independent semantic comparison. Some unusual rigs
will require explicit mapping rather than optimistic automatic conversion.
