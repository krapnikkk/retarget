import type { ImportAdapterProbe } from "@/adapters/types";
import { getRigProfile, type RigProfileId } from "@/profiles";

const MAX_PROBE_BYTES = 4 * 1024 * 1024;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const inspectionCache = new WeakMap<File, Promise<FileInspection>>();

type ProbeRole = "avatar" | "motion";
type ProbeContainer = "bvh" | "fbx" | "gltf" | "mmd-model" | "vmd";

type ProbeConfig = {
  container: ProbeContainer;
  extensions: readonly string[];
  profile: RigProfileId;
  role: ProbeRole;
  requiredExtensions?: readonly string[];
  ecosystemMarkers?: readonly string[];
};

type FileInspection = {
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
): Promise<ImportAdapterProbe> {
  const warnings: string[] = [];
  const evidence: string[] = [];
  let maximumConfidence = 1;
  const lowercaseName = file.name.toLowerCase();
  if (!config.extensions.some((extension) => lowercaseName.endsWith(extension))) {
    return {
      confidence: 0,
      profile: config.profile,
      evidence,
      warnings: [`extension does not match ${config.extensions.join(", ")}`],
    };
  }

  const inspection = await inspectFile(file);
  warnings.push(...inspection.warnings);
  evidence.push(`extension matches ${config.extensions.join(", ")}`);
  let confidence = 0.15;

  const signature = detectContainerSignature(config.container, inspection);
  if (signature) {
    confidence += signature.confidence;
    evidence.push(signature.evidence);
  } else {
    warnings.push(`${config.container} content signature was not found`);
  }

  if (inspection.gltf) {
    evidence.push("glTF declares +Y up, +Z forward, and meter units");
    if (config.role === "motion") {
      if (inspection.gltf.animations > 0) {
        confidence += 0.15;
        evidence.push(`${inspection.gltf.animations} animation(s) declared`);
      } else {
        warnings.push("glTF does not declare an animation");
      }
    } else if (inspection.gltf.hasSkin) {
      confidence += 0.15;
      evidence.push("glTF declares a skin");
    } else {
      warnings.push("glTF does not declare a skin");
    }
  }

  if (config.requiredExtensions?.length) {
    const matched = config.requiredExtensions.filter((extension) =>
      inspection.gltf?.extensions.has(extension),
    );
    if (matched.length > 0) {
      confidence += 0.35;
      evidence.push(`extension evidence: ${matched.join(", ")}`);
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
      evidence.push(`ecosystem markers: ${markers.join(", ")}`);
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
      evidence.push(
        `required bone alias coverage ${matched.length}/${required.length}`,
      );
      const hasLeft = matched.some((bone) => bone.humanoid.startsWith("left"));
      const hasRight = matched.some((bone) => bone.humanoid.startsWith("right"));
      if (hasLeft && hasRight) evidence.push("left/right bone evidence is symmetric");
      if (coverage < 0.7) warnings.push("required bone alias coverage is below 70%");
    } else if (config.container === "fbx" || config.container === "gltf") {
      warnings.push("no required humanoid bone aliases were found");
    }
  }

  if (config.container === "fbx") {
    if (/UpAxis/i.test(inspection.text)) evidence.push("FBX UpAxis metadata found");
    else warnings.push("FBX UpAxis metadata was not found in the probe window");
    if (/FrontAxis/i.test(inspection.text)) evidence.push("FBX FrontAxis metadata found");
    else warnings.push("FBX FrontAxis metadata was not found in the probe window");
    if (/UnitScaleFactor/i.test(inspection.text)) {
      evidence.push("FBX UnitScaleFactor metadata found");
    } else {
      warnings.push("FBX unit metadata was not found in the probe window");
    }
  }

  return {
    confidence: Math.min(Number(confidence.toFixed(3)), maximumConfidence),
    profile: config.profile,
    evidence,
    warnings,
  };
}

function inspectFile(file: File) {
  const cached = inspectionCache.get(file);
  if (cached) return cached;
  const inspection = createInspection(file);
  inspectionCache.set(file, inspection);
  return inspection;
}

async function createInspection(file: File): Promise<FileInspection> {
  const binaryGLTF = /\.(?:glb|vrm|vrma)$/i.test(file.name);
  const bytesRead = Math.min(file.size, binaryGLTF ? 20 : MAX_PROBE_BYTES);
  const bytes = new Uint8Array(await file.slice(0, bytesRead).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const warnings =
    file.size > MAX_PROBE_BYTES
      ? [`probe inspected the first ${MAX_PROBE_BYTES} of ${file.size} bytes`]
      : [];
  const gltf = await inspectGLTF(file, bytes, text, warnings);
  const tokenSource = [text, ...(gltf?.nodeNames ?? [])].join(" ");
  const normalizedTokens = new Set(
    tokenSource
      .split(/[^\p{L}\p{N}_:.-]+/u)
      .map(normalizeMarker)
      .filter((token) => token.length > 1),
  );
  return { bytesRead, fileSize: file.size, gltf, normalizedTokens, text, warnings };
}

async function inspectGLTF(
  file: File,
  bytes: Uint8Array,
  text: string,
  warnings: string[],
) {
  let json: unknown = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
    const jsonLength = view.getUint32(12, true);
    const chunkType = view.getUint32(16, true);
    if (chunkType !== GLB_JSON_CHUNK || jsonLength > MAX_PROBE_BYTES) {
      warnings.push("glTF JSON chunk is missing or exceeds the probe budget");
      return null;
    }
    const jsonBytes =
      20 + jsonLength <= bytes.byteLength
        ? bytes.subarray(20, 20 + jsonLength)
        : new Uint8Array(await file.slice(20, 20 + jsonLength).arrayBuffer());
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
  container: ProbeContainer,
  inspection: FileInspection,
) {
  if (container === "gltf" && inspection.gltf) {
    return { confidence: 0.2, evidence: "glTF container and JSON chunk parsed" };
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
