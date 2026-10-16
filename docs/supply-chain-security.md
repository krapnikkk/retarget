# Supply-chain security

[简体中文](zh-CN/supply-chain-security.md)

`@krapnik/retarget` is released as a scoped public package on the public npm
registry. Consumer applications are not library release gates and are not
modified as part of a library release.

## Release procedure

1. Run `pnpm install --frozen-lockfile` using the declared Node and pnpm toolchain.
2. Run `pnpm verify`, including type checking, fixtures, the complete test suite,
   correctness coverage, package-size diagnostics, packed-entry installation,
   and the packed browser Worker request/result smoke test. `prepublishOnly`
   also enforces `pnpm verify` when publishing.
3. Run `pnpm verify:ecosystem` for the pinned certified case, using the required
   Blender and Godot builds. Keep ecosystem evidence separate from local checks.
4. Run `pnpm audit --prod` and record a production dependency license inventory.
   Review findings before release.
5. From the maintainer's npm account, use two-factor authentication (2FA) to run
   `npm publish --registry https://registry.npmjs.org/`. The package's
   `publishConfig.access` is `public`. Registry credentials are maintainer-owned
   secrets.
6. Tag the published commit as `vVERSION` and push the tag. Publish a GitHub
   Release for that tag summarizing changes and the ecosystem verification
   result. The npm registry records the tarball integrity, and published
   versions are immutable.

Packed artifacts remain ignored by Git. Publication is a separate release
step after verification. Automated consumer updates, required hosted CI, and
release SBOMs remain deferred under the current maintenance profile.

## Commit verification

Run `pnpm hooks:install` once per checkout. The versioned pre-commit hook runs
`pnpm check`: the domain-layer import rule, incremental type checking, and the
`unit` test project. The complete `pnpm verify` gate runs before release and
through `prepublishOnly`. Hosted CI is an optional manual release/review
confirmation rather than a per-commit dependency.

The MIT license covers the library code only; consumer assets and generated
outputs retain their own provenance and license obligations.
