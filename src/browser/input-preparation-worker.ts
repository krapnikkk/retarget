import {
  listAssetPackageEntries,
  isZipAssetPackage,
  prepareAssetDirectory,
  prepareAssetInput,
  type AssetPackageRole,
  type PreparedAssetPackageEntry,
  type ReadableDirectoryHandle,
} from "@/import/asset-package";
import { createProcessingDeadline } from "@/processing-budget";
import { RetargetError, isRetargetError } from "@/retarget/errors";
import { inspectImportContent } from "@/adapters/probe";
import {
  browserInputRoleSupportsContainer,
  classifyBrowserInput,
} from "./input-probe";
import type {
  BrowserInputPreparationRequest,
  BrowserInputPreparationWireResult,
} from "./input-preparation-protocol";
import type {
  BrowserInputPreparationPhase,
  BrowserInputSelection,
} from "./input-preparation-types";

type InputPreparationProgress = (
  phase: BrowserInputPreparationPhase,
  progress: number,
) => void;

export async function executeBrowserInputPreparation(
  request: BrowserInputPreparationRequest,
  onProgress: InputPreparationProgress,
): Promise<BrowserInputPreparationWireResult> {
  const { budget, role, source } = request.task;
  const deadline = createProcessingDeadline(budget.maxElapsedMs);
  const progress = (
    phase: BrowserInputPreparationPhase,
    value: number,
  ) => {
    deadline.checkpoint(`input-${phase}`);
    onProgress(phase, value);
  };

  try {
    progress("discover", 0.02);
    let selectedPackageInput: BrowserInputSelection | undefined;
    const selectPrimary = async (
      entries: readonly PreparedAssetPackageEntry[],
      selectedRole: AssetPackageRole,
    ) => {
      progress("probe", 0.55);
      const selected = await selectPackagePrimary(
        entries,
        selectedRole,
        budget.maxProbeBytes,
      );
      selectedPackageInput = selected.selection;
      return selected.path;
    };

    let prepared: Awaited<ReturnType<typeof prepareAssetInput>>;
    if (source.kind === "directory-handle") {
      progress("read", 0.12);
      progress("unpack", 0.28);
      prepared = await prepareAssetDirectory(
        source.handle as unknown as ReadableDirectoryHandle,
        role,
        {
          ...budget,
          selectPrimary,
        },
      );
    } else {
      progress("read", 0.12);
      const file = source.kind === "file"
        ? source.file
        : await source.handle.getFile();
      if (await isZipAssetPackage(file)) {
        progress("unpack", 0.28);
      }
      prepared = await prepareAssetInput(file, role, {
        ...budget,
        selectPrimary,
      });
    }

    deadline.checkpoint("input-probe");
    progress("probe", 0.68);
    const selection = selectedPackageInput ?? await classifyBrowserInput(
      prepared.file,
      role,
      budget.maxProbeBytes,
    );
    progress("resolve", 0.88);
    const entries = prepared.report
      ? listAssetPackageEntries(prepared.file)?.map((entry) => ({
          ...entry,
          byteLength: entry.blob.size,
        }))
      : undefined;
    deadline.checkpoint("input-resolve");
    progress("complete", 1);
    return {
      file: prepared.file,
      report: prepared.report,
      entries,
      selection,
    };
  } catch (cause) {
    if (isRetargetError(cause)) throw cause;
    throw new RetargetError("PACKAGE_INVALID", {
      cause,
      details: { role },
      message: cause instanceof Error
        ? cause.message
        : "The browser input package could not be prepared.",
    });
  }
}

async function selectPackagePrimary(
  entries: readonly PreparedAssetPackageEntry[],
  role: AssetPackageRole,
  maxProbeBytes: number,
) {
  if (entries.length === 0) {
    throw new RetargetError("PACKAGE_INVALID", {
      details: { entryCount: 0, role },
      message: "The asset package does not contain any usable files.",
    });
  }

  const scanBudget = Math.floor(maxProbeBytes / 2);
  const perEntryScanBytes = Math.floor(scanBudget / entries.length);
  let bytesInspected = 0;
  const recognized: Array<{
    entry: PreparedAssetPackageEntry;
    file: File;
  }> = [];
  for (const entry of entries) {
    const file = createCandidateFile(entry);
    const inspection = await inspectImportContent(file, {
      maxBytes: perEntryScanBytes,
    });
    bytesInspected += inspection.bytesInspected;
    if (
      inspection.container &&
      browserInputRoleSupportsContainer(role, inspection.container)
    ) {
      recognized.push({ entry, file });
    }
  }

  const remainingBytes = Math.max(0, maxProbeBytes - bytesInspected);
  const perCandidateBytes = recognized.length > 0
    ? Math.floor(remainingBytes / recognized.length)
    : 0;
  const classified = await Promise.all(
    recognized.map(async (candidate) => ({
      ...candidate,
      selection: await classifyBrowserInput(
        candidate.file,
        role,
        perCandidateBytes,
      ),
    })),
  );
  bytesInspected += classified.reduce(
    (total, candidate) => total + candidate.selection.bytesInspected,
    0,
  );
  const matches = classified.filter(
    (candidate) => candidate.selection.status === "matched",
  );
  if (matches.length !== 1) {
    throw new RetargetError("PACKAGE_INVALID", {
      details: {
        bytesInspected,
        candidates: classified.map((candidate) => ({
          path: candidate.entry.name,
          status: candidate.selection.status,
          container: candidate.selection.container,
          formatId: candidate.selection.formatId,
        })),
        matchCount: matches.length,
        role,
      },
      message: matches.length === 0
        ? `The asset package does not contain a content-verified ${role} input.`
        : `The asset package contains multiple content-verified ${role} inputs.`,
    });
  }

  const match = matches[0]!;
  return {
    path: match.entry.name,
    selection: {
      ...match.selection,
      bytesInspected,
    },
  };
}

function createCandidateFile(entry: PreparedAssetPackageEntry) {
  return new File(
    [entry.blob],
    entry.name.replace(/\\/g, "/").split("/").at(-1) ?? "input",
    { type: entry.blob.type },
  );
}
