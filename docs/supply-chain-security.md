# Supply-chain security

[简体中文](zh-CN/supply-chain-security.md)

The package remains private in registry metadata and is distributed to
approved downstream consumers as a locally packed, exact-version tarball. A
consumer application is not a library readiness gate and is not modified as
part of the library release.

Before every controlled release, the local release operator must record:

- `pnpm install --frozen-lockfile`;
- `pnpm verify`, including type checking, fixtures, the complete test suite,
  correctness coverage, package-size limits, packed-entry installation, and
  the packed browser Worker request/result smoke test;
- `pnpm verify:ecosystem` for the pinned certified case;
- `pnpm audit --prod` and a production dependency license inventory;
- the tarball filename, byte length, SHA-256, package version, and verification
  results in a committed release receipt.

The tarball remains ignored by Git and is transferred separately. Registry
publication, registry credentials, automated consumer updates, CI, and release
SBOMs remain deferred under the local maintenance profile. The MIT license
covers the library code only; consumer assets and generated outputs retain
their own provenance and license obligations.
