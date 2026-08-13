# Supply-chain security

The package is private and is not consumed by the web application yet.

Before the first consumer integration, CI must require:

- a frozen pnpm install;
- type checking and the complete test suite;
- correctness coverage gates;
- dependency advisory and OSV scans;
- a dist-only package build;
- installation and import of every public entry from the packed tarball;
- verification that the browser Worker is present in the tarball;
- provenance and SHA-256 verification for committed and downloaded fixtures.

Publishing, registry credentials, automated consumer updates, and release SBOMs
remain deferred until the package API is approved for consumption.
