import type {
  ImportAdapterProbe,
  ImportAdapterProbeOptions,
  ImportProbeEvidenceDetail,
} from "@/adapters/types";
import { getRigProfile, type RigProfileId } from "@/profiles";

export const MAX_IMPORT_PROBE_BYTES = 4 * 1024 * 1024;
export const MIN_IMPORT_PROBE_CONFIDENCE = 0.35;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const inspectionCache = new WeakMap<
  File,
  Map<number, Promise<FileInspection>>
>();

export type ImportProbeRole = "avatar" | "motion";
export type ImportProbeContainer =
  | "bvh"
  | "fbx"
  | "gltf"
  | "mmd-model"
  | "vmd";

export type ImportContentInspection = {
  bytesInspected: number;
  container: ImportProbeContainer | null;
  evidence: ImportProbeEvidenceDetail[];
  warnings: string[];
};

type ProbeConfig = {
  container: ImportProbeContainer;
  extensions: readonly string[];
  profile: RigProfileId;
  role: ImportProbeRole;
  requiredExtensions?: readonly string[];
  ecosystemMarkers?: readonly string[];
};

type FileInspection = {
  binaryGLTF: boolean;
  bytesRead: number;
  fileSize: number;
  gltf: {
    animations: number;
    extensions: Set<string>;
    hasSkin: boolean;
    nodeNames: string[];
  } | null;
  normalizedTokens: Set<string>;
  text: string;
  warnings: string[];
};

export async function probeImportAdapter(
  file: File,
  config: ProbeConfig,
  options: ImportAdapterProbeOptions = {},
): Promise<ImportAdapterProbe> {
  const warnings: string[] = [];
  const evidence: string[] = [];
  const evidenceDetails: ImportProbeEvidenceDetail[] = [];
  const addEvidence = (
    code: ImportProbeEvidenceDetail["code"],
    message: string,
  ) => {
    evidence.push(message);
    evidenceDetails.push({ code, message });
  };
  let maximumConfidence = 1;
  const lowercaseName = file.name.toLowerCase();
  const extensionMatches = config.extensions.some((extension) =>
    lowercaseName.endsWith(extension),
  );

  const inspection = await inspectFile(file, options.maxBytes);
  const hasRequiredExtensionEvidence = Boolean(
    config.requiredExtensions?.some((extension) =>
      inspection.gltf?.extensions.has(extension),
    ),
  );
  warnings.push(...inspection.warnings);
  let confidence = 0;
  if (extensionMatches) {
    confidence += 0.05;
    addEvidence(
      "extension-hint",
      `extension hint matches ${config.extensions.join(", ")}`,
    );
  } else {
    warnings.push(`extension hint does not match ${config.extensions.join(", ")}`);
  }

  const signature = detectContainerSignature(config.container, inspection);
  if (signature) {
    confidence += signature.confidence;
    addEvidence("container-signature", signature.evidence);
  } else {
    maximumConfidence = Math.min(maximumConfidence, MIN_IMPORT_PROBE_CONFIDENCE - 0.01);
    warnings.push(`${config.container} content signature was not found`);
  }

  if (inspection.gltf) {
    addEvidence(
      "coordinate-convention",
      "glTF declares +Y up, +Z forward, and meter units",
    );
    if (config.role === "motion") {
      if (inspection.gltf.animations > 0) {
        confidence += 0.15;
        addEvidence(
          "declared-animation",
          `${inspection.gltf.animations} animation(s) declared`,
        );
      } else {
        if (!hasRequiredExtensionEvidence) {
          maximumConfidence = Math.min(maximumConfidence, 0.34);
        }
        warnings.push("glTF does not declare an animation");
      }
    } else if (inspection.gltf.hasSkin) {
      confidence += 0.15;
      addEvidence("declared-skin", "glTF declares a skin");
    } else {
      if (!hasRequiredExtensionEvidence) {
        maximumConfidence = Math.min(maximumConfidence, 0.34);
      }
      warnings.push("glTF does not declare a skin");
    }
  }

  if (config.requiredExtensions?.length) {
    const matched = config.requiredExtensions.filter((extension) =>
      inspection.gltf?.extensions.has(extension),
    );
    if (matched.length > 0) {
      confidence += 0.35;
      addEvidence(
        "gltf-extension",
        `extension evidence: ${matched.join(", ")}`,
      );
    } else {
      maximumConfidence = Math.min(maximumConfidence, 0.34);
      warnings.push(
        `missing required extension evidence: ${config.requiredExtensions.join(", ")}`,
      );
    }
  }

  if (config.ecosystemMarkers?.length) {
    const markers = config.ecosystemMarkers.filter((marker) =>
      inspectionHasMarker(inspection, marker),
    );
    if (markers.length > 0) {
      confidence += 0.25;
      addEvidence(
        "ecosystem-marker",
        `ecosystem markers: ${markers.join(", ")}`,
      );
    } else {
      maximumConfidence = Math.min(maximumConfidence, 0.34);
      warnings.push("ecosystem-specific node evidence was not found");
    }
  }

  const profile = getRigProfile(config.profile);
  if (profile) {
    const required = profile.bones.filter((bone) => bone.required);
    const matched = required.filter((bone) =>
      bone.aliases.some((alias) => inspectionHasMarker(inspection, alias)),
    );
    if (required.length > 0 && matched.length > 0) {
      const coverage = matched.length / required.length;
      confidence += Math.min(coverage * 0.3, 0.3);
      addEvidence(
        "profile-bone-coverage",
        `required bone alias coverage ${matched.length}/${required.length}`,
      );
      const hasLeft = matched.some((bone) => bone.humanoid.startsWith("left"));
      const hasRight = matched.some((bone) => bone.humanoid.startsWith("right"));
      if (hasLeft && hasRight) {
        addEvidence(
          "profile-symmetry",
          "left/right bone evidence is symmetric",
        );
      }
      if (coverage < 0.7) warnings.push("required bone alias coverage is below 70%");
    } else if (config.container === "fbx" || config.container === "gltf") {
      warnings.push("no required humanoid bone aliases were found");
    }
  }

  if (config.container === "fbx") {
    if (/UpAxis/i.test(inspection.text)) {
      addEvidence("fbx-axis-metadata", "FBX UpAxis metadata found");
    }
    else warnings.push("FBX UpAxis metadata was not found in the probe window");
    if (/FrontAxis/i.test(inspection.text)) {
      addEvidence("fbx-axis-metadata", "FBX FrontAxis metadata found");
    }
    else warnings.push("FBX FrontAxis metadata was not found in the probe window");
    if (/UnitScaleFactor/i.test(inspection.text)) {
      addEvidence("fbx-unit-metadata", "FBX UnitScaleFactor metadata found");
    } else {
      warnings.push("FBX unit metadata was not found in the probe window");
    }
  }

  return {
    bytesInspected: inspection.bytesRead,
    confidence: Math.min(Number(confidence.toFixed(3)), maximumConfidence),
    contentSignature: Boolean(signature),
    profile: config.profile,
    evidence,
    evidenceDetails,
    warnings,
  };
}

export async function inspectImportContent(
  file: File,
  options: ImportAdapterProbeOptions = {},
): Promise<ImportContentInspection> {
  const inspection = await inspectFile(file, options.maxBytes);
  const containers: ImportProbeContainer[] = [
    "gltf",
    "fbx",
    "bvh",
    "vmd",
    "mmd-model",
  ];
  const detected = containers
    .map((container) => ({
      container,
      signature: detectContainerSignature(container, inspection),
    }))
    .find((candidate) => candidate.signature);
  return {
    bytesInspected: inspection.bytesRead,
    container: detected?.container ?? null,
    evidence: detected?.signature
      ? [{ code: "container-signature", message: detected.signature.evidence }]
      : [],
    warnings: [...inspection.warnings],
  };
}

function inspectFile(file: File, requestedMaxBytes?: number) {
  const maxBytes = resolveProbeByteLimit(requestedMaxBytes);
  let cachedByLimit = inspectionCache.get(file);
  if (!cachedByLimit) {
    cachedByLimit = new Map();
    inspectionCache.set(file, cachedByLimit);
  }
  const cached = cachedByLimit.get(maxBytes);
  if (cached) return cached;
  const inspection = createInspection(file, maxBytes);
  cachedByLimit.set(maxBytes, inspection);
  return inspection;
}

async function createInspection(
  file: File,
  maxProbeBytes: number,
): Promise<FileInspection> {
  const headerByteLength = Math.min(file.size, maxProbeBytes, 20);
  const header = new Uint8Array(
    await file.slice(0, headerByteLength).arrayBuffer(),
  );
  const headerView = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  const binaryGLTF =
    header.byteLength >= 4 && headerView.getUint32(0, true) === GLB_MAGIC;
  const requestedBytes = binaryGLTF && header.byteLength >= 20
    ? Math.min(20 + headerView.getUint32(12, true), maxProbeBytes)
    : maxProbeBytes;
  const bytesRead = Math.min(file.size, requestedBytes);
  const bytes = bytesRead === header.byteLength
    ? header
    : new Uint8Array(await file.slice(0, bytesRead).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const warnings =
    file.size > maxProbeBytes
      ? [`probe inspected the first ${maxProbeBytes} of ${file.size} bytes`]
      : [];
  const gltf = inspectGLTF(bytes, text, warnings, maxProbeBytes);
  const tokenSource = [text, ...(gltf?.nodeNames ?? [])].join(" ");
  const normalizedTokens = new Set(
    tokenSource
      .split(/[^\p{L}\p{N}_:.-]+/u)
      .map(normalizeMarker)
      .filter((token) => token.length > 1),
  );
  return {
    binaryGLTF,
    bytesRead,
    fileSize: file.size,
    gltf,
    normalizedTokens,
    text,
    warnings,
  };
}

function inspectGLTF(
  bytes: Uint8Array,
  text: string,
  warnings: string[],
  maxProbeBytes: number,
) {
  let json: unknown = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const jsonLength = view.getUint32(12, true);
    const chunkType = view.getUint32(16, true);
    if (chunkType !== GLB_JSON_CHUNK || jsonLength > maxProbeBytes) {
      warnings.push("glTF JSON chunk is missing or exceeds the probe budget");
      return null;
    }
    if (20 + jsonLength > bytes.byteLength) {
      warnings.push("glTF JSON chunk exceeds the inspected probe window");
      return null;
    }
    const jsonBytes = bytes.subarray(20, 20 + jsonLength);
    json = parseJSON(new TextDecoder().decode(jsonBytes), warnings);
  } else if (/^\s*\{/.test(text)) {
    json = parseJSON(text, warnings);
  }
  if (!json || typeof json !== "object") return null;

  const document = json as Record<string, unknown>;
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const extensionsUsed = Array.isArray(document.extensionsUsed)
    ? document.extensionsUsed.filter((value): value is string => typeof value === "string")
    : [];
  const rootExtensions =
    document.extensions && typeof document.extensions === "object"
      ? Object.keys(document.extensions)
      : [];
  return {
    animations: Array.isArray(document.animations) ? document.animations.length : 0,
    extensions: new Set([...extensionsUsed, ...rootExtensions]),
    hasSkin: Array.isArray(document.skins) && document.skins.length > 0,
    nodeNames: nodes.flatMap((node) =>
      node &&
      typeof node === "object" &&
      "name" in node &&
      typeof node.name === "string"
        ? [node.name]
        : [],
    ),
  };
}

function parseJSON(text: string, warnings: string[]) {
  try {
    return JSON.parse(text.replace(/\0+$/g, ""));
  } catch {
    warnings.push("glTF JSON could not be parsed within the probe budget");
    return null;
  }
}

function detectContainerSignature(
  container: ImportProbeContainer,
  inspection: FileInspection,
) {
  if (container === "gltf" && (inspection.gltf || inspection.binaryGLTF)) {
    return {
      confidence: inspection.gltf ? 0.2 : 0.15,
      evidence: inspection.gltf
        ? "glTF container and JSON chunk parsed"
        : "glTF binary container signature found",
    };
  }
  if (
    container === "fbx" &&
    (/Kaydara FBX Binary/i.test(inspection.text) ||
      /FBXHeaderExtension/i.test(inspection.text))
  ) {
    return { confidence: 0.25, evidence: "FBX header signature found" };
  }
  if (
    container === "bvh" &&
    /HIERARCHY/i.test(inspection.text) &&
    /MOTION/i.test(inspection.text)
  ) {
    return { confidence: 0.55, evidence: "BVH HIERARCHY and MOTION sections found" };
  }
  if (container === "vmd" && /Vocaloid Motion Data/i.test(inspection.text)) {
    return { confidence: 0.6, evidence: "VMD header signature found" };
  }
  if (
    container === "mmd-model" &&
    (/^PMX /i.test(inspection.text) || /^Pmd/i.test(inspection.text))
  ) {
    return { confidence: 0.6, evidence: "PMX/PMD header signature found" };
  }
  return null;
}

function inspectionHasMarker(inspection: FileInspection, marker: string) {
  const normalized = normalizeMarker(marker);
  if (!normalized) return false;
  if (inspection.normalizedTokens.has(normalized)) return true;
  return [...inspection.normalizedTokens].some((token) => token.includes(normalized));
}

function normalizeMarker(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function resolveProbeByteLimit(value: number | undefined) {
  if (value === undefined) return MAX_IMPORT_PROBE_BYTES;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_IMPORT_PROBE_BYTES);
}
