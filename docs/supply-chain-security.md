# Supply-chain security

[简体中文](zh-CN/supply-chain-security.md)

The package is distributed to approved downstream consumers as an exact version
from the approved private registry. A sibling checkout is allowed only for
coordinated development, and a local packed artifact is verification evidence,
not the distribution channel. A consumer application is not a library readiness
gate and is not modified as part of the library release.

Before every controlled release, the local release operator must record:

- `pnpm install --frozen-lockfile`;
- `pnpm verify`, including type checking, fixtures, the complete test suite,
  correctness coverage, package-size diagnostics, packed-entry installation, and
  the packed browser Worker request/result smoke test;
- `pnpm verify:ecosystem` for the pinned certified case;
- `pnpm audit --prod` and a production dependency license inventory;
- the tarball filename, byte length, SHA-256, package version, and verification
  results in a committed release receipt.

For routine commits in this private repository, run `pnpm hooks:install` once
per checkout. The versioned pre-commit hook runs the complete `pnpm verify`
gate, including the domain-layer import rule. Hosted CI is an optional manual
release/review confirmation rather than a per-commit dependency. Bypassing the
hook does not waive the requirement to record a successful local verification.

Packed artifacts remain ignored by Git. Registry credentials are operator-owned
secrets; publication is a distinct release gate after local verification.
Automated consumer updates, required hosted CI, and release SBOMs remain
deferred under the local maintenance profile. The MIT license covers the
library code only; consumer assets and generated outputs retain their own
provenance and license obligations.
