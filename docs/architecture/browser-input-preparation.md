# Browser input preparation

[简体中文](../zh-CN/architecture/browser-input-preparation.md)

`3dretarget/browser` exposes `prepareBrowserAssetInput()` as the coarse boundary
between host-owned file acquisition and library-owned, untrusted input
preparation. This API does not own picker UI or persist browser permissions.

## Ownership boundary

The host owns the user gesture and obtains a `File`, readable file handle, or
readable directory handle. After the host supplies that value, the library
owns bounded traversal, ZIP expansion, primary-file selection, path
normalization, sidecar resolution, adapter selection, Worker isolation, and
resource disposal.

The result remains browser-facing: it contains a `File` and an explicit
`dispose()` method. Root, IO, validation, and certification entries remain free
of `File` and DOM contracts.

## Content-first selection

File extensions contribute only low-confidence evidence. The preparation
Worker inspects a bounded content window and returns a `selection` with:

- `status`: `matched`, `inconclusive`, or `unsupported`;
- a deterministic role, format ID, profile ID, and detected container when
  available;
- structured evidence codes, warnings, confidence, and `bytesInspected`.

`inconclusive` means the bounded evidence did not identify a supported input.
`unsupported` means the content identified a known container that does not
support the requested role. A renamed input can still match from its signature,
while a misleading supported extension cannot create a match by itself.

Package primary selection applies the same rule across ZIP and directory
entries. It rejects zero or multiple content-verified primaries instead of
guessing from filenames.

## Budgets

The stable budget fields are:

| Field | Meaning |
| --- | --- |
| `maxProbeBytes` | Total bounded evidence window used to select an input |
| `maxEntries` | Maximum traversed or archived entries |
| `maxCompressedBytes` | Maximum compressed/archive input bytes |
| `maxExpandedBytes` | Maximum total expanded bytes |
| `maxSingleEntryBytes` | Maximum bytes retained by one entry |
| `maxRetainedBytes` | Maximum total Blob-backed package bytes retained |
| `maxElapsedMs` | Worker deadline for the preparation job |

Callers may lower limits. Values above the library ceiling are clamped; zero,
negative, non-integer, and non-finite limits fail with
`PROCESSING_OPTION_INVALID`. File and declared archive sizes are checked before
large reads or decompression.

## Worker and progress

Browser preparation reuses the packed package Worker at
`dist/workers/retarget.worker.js`. It fails with `WORKER_UNAVAILABLE` when an
isolated Worker cannot be created and never silently runs untrusted preparation
on the main thread. `AbortSignal` terminates the active Worker.

Progress uses the dedicated phase union:

```text
discover | read | probe | unpack | resolve | complete
```

Consumers localize the phase identifier and do not parse progress messages.
The execution order reflects the input: an archive must be unpacked before its
inner primary can be probed.

## Resource lifecycle

Prepared packages retain Blob-backed entries so existing loaders can resolve
relative sidecars. `collectTransferable()` creates the bounded, serializable
resource payload used by later Worker jobs. `dispose()` releases the package
context, is idempotent, and prevents later transferable collection.

## Public example

```ts
import { prepareBrowserAssetInput } from "3dretarget/browser";

const prepared = await prepareBrowserAssetInput(file, {
  role: "motion",
  signal,
  onProgress({ phase }) {
    updateLocalizedProgress(phase);
  },
});

try {
  if (prepared.selection.status !== "matched") {
    showInputRecovery(prepared.selection);
    return;
  }
  await usePreparedFile(prepared.file);
} finally {
  prepared.dispose();
}
```

Range-based animated GLB export and paired avatar-motion archives are separate
capabilities. Consumer parity and removal of downstream duplicate code are not
acceptance gates for this contract.
