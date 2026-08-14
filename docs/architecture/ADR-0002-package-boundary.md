# ADR-0002: Retargeting engine ownership moves to `3dretarget`

[简体中文](../zh-CN/architecture/ADR-0002-package-boundary.md)

- Status: accepted
- Date: 2026-08-14

## Context

The web application currently contains reusable parsers, import/export adapters,
rig models, solvers, validation, certification, and Worker execution code. This
ties engine changes and proof resources to a web release cycle.

## Decision

`3dretarget` is an independent package and repository. It owns reusable
retargeting code, tests, corpus manifests, and packed Worker output.
`3dretarget-online` remains a web product and will not install this package until
the independent API, package, and correctness gates are stable.

The relationship is inspired by a shared-core/consumer model, but the package
surface, release gates, resources, and integration workflow are designed for the
retargeting domain rather than copied from another repository.

## Consequences

- During stabilization, the implementations temporarily exist in both
  repositories. New engine fixes should be applied here first and consciously
  mirrored only when the current web product still needs them.
- No consumer synchronization script is introduced yet.
- A later ADR must approve the consumer cutover and deletion of the web copy.
