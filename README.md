# 3dretarget

`3dretarget` is the standalone motion-retargeting engine extracted from
`3dretarget-online`. It owns format probing, source normalization, canonical
motion, rig inspection, target solving, validation, export, processing budgets,
and the cancellable browser Worker runtime.

The package is intentionally private while its API and packed Worker contract
stabilize. `3dretarget-online` does not consume this package yet.

## Ownership boundary

- This repository owns reusable retargeting behavior and its proof corpus.
- Web routes, React state, preview presentation, market publishing, localization,
  analytics, and deployment remain in `3dretarget-online`.
- `3d-core` is a separate model-format/Scene IR domain. Reuse requires matching
  semantics; similar format names alone are not an integration contract.

## Development

```powershell
pnpm install
pnpm verify
```

Large research corpora are downloaded into the ignored `references/` directory.
Committed fixtures include provenance and hashes.

## Public entries

- `3dretarget`
- `3dretarget/browser`
- `3dretarget/io`
- `3dretarget/node`
- `3dretarget/validation`
- `3dretarget/certification`

Consumer installation and synchronization are deliberately deferred until this
repository passes its independent stability gates.
