# Browser input preparation

[简体中文](../zh-CN/architecture/browser-input-preparation.md)

`3dretarget/browser/input` exposes `prepareBrowserAssetInput()` as the coarse
boundary between host-owned file acquisition and library-owned, untrusted
input preparation. `3dretarget/browser` re-exports the same API for
compatibility. The input-only entry exists because production bundle evidence
shows that the full browser entry also carries retarget pipelines and
format-specific runtimes. Neither entry owns picker UI or persists browser
permissions.

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

Browser preparation runs in the dedicated packed Worker at
`dist/workers/input-preparation.worker.js`. That Worker contains bounded
discovery, probing, archive/package handling, and transferable construction;
it does not share the retarget solver or format parser runtime graph. The
retarget Worker remains a separate operation boundary.

Preparation messages use schema version `1`. Both sides validate request and
response discriminators, job identity, role, budgets, progress, registered
error codes, and success-result structure. Malformed messages fail closed with
`WORKER_PROTOCOL_INVALID`. Creation failures use `WORKER_UNAVAILABLE`, and
untrusted preparation never silently falls back to the main thread.
`AbortSignal`, deadlines, `messageerror`, clone errors, and progress-callback
failures all terminate the active Worker through the same cleanup path.

The package gate installs the packed tarball into a temporary consumer, builds
`3dretarget/browser/input` with a production bundler, and checks the emitted
code plus source-module evidence. The entry and its Worker must exclude MMD,
VMD, Ammo, FBX loader, and full retarget-job markers, while independent size
baselines cover the input surface, Worker, and consumer bundle.

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
