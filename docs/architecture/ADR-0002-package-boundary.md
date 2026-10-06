# ADR-0002: Consumer-neutral library boundary

[简体中文](../zh-CN/architecture/ADR-0002-package-boundary.md)

- Status: accepted
- Date: 2026-08-14

## Context

Reusable retargeting behavior needs stable contracts, proof resources, and a
release cadence based on domain correctness. Coupling those decisions to one
application produces product-specific APIs, reverse dependencies, and release
gates that do not measure library quality.

## Decision

`@krapnik/retarget` is an independent, consumer-neutral library. It owns reusable
retargeting code, public contracts, tests, corpus manifests, and packed runtime
artifacts.

The roadmap is driven by reusable capabilities and evidence. A downstream
request belongs here only when it can be specified without application state,
expressed through stable platform or serializable contracts, and verified with
legal fixtures and independent acceptance criteria.

No consumer repository, application build, deployment platform, or release
schedule is a dependency or readiness gate for this library.

## Consequences

- Consumers pin a library version and own their adapters, integration tests,
  product behavior, deployment, and upgrade timing.
- The library may accept real-world fixtures from consumers, but their origin
  does not grant a consumer privileged architectural status.
- Public compatibility is managed through versioned contracts and library-owned
  tests, not mirrored implementations or repository synchronization.
- Browser and Node entries are platform surfaces, not product integrations.
- Product UI, catalogs, analytics, hosting, and application-specific workflow
  remain outside the package.
