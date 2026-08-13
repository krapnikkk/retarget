import { WebIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import {
  VRMCVRM,
  VRMC_VRM_EXTENSIONS,
  VRM_REQUIRED_HUMAN_BONE_NAMES,
  assertVRMDocument,
  writeVRM,
} from "gltf-transform-vrm-extensions";
import { collectHumanoidNodes } from "@/export/avatar-glb";
import { getOpenAssetLicense } from "@/licensing/open-license";

export type VRMAuthoringMetadata = {
  name: string;
  author: string;
  license: string;
  sourceUrl?: string;
};

type WritableVRMExtension = {
  data?: {
    specVersion: "1.0";
    meta: Record<string, unknown>;
    humanoid: {
      humanBones: Record<string, Record<string, unknown>>;
    };
  };
  humanoidBoneNodes: Map<string, GltfNode>;
  samplers: unknown[];
  write(context: VRMWriteContext): unknown;
};

type VRMWriteContext = {
  jsonDoc: { json: { samplers?: unknown[] } };
};

const VRM_LICENSE_URL = "https://vrm.dev/licenses/1.0/";

export async function authorCanonicalGLBAsVRM(
  document: Document,
  metadata: VRMAuthoringMetadata,
): Promise<Uint8Array> {
  const extension = document.createExtension(VRMCVRM).setRequired(false);
  const writableExtension = extension as unknown as WritableVRMExtension;
  preserveTextureSamplers(writableExtension);
  const nodesByBone = new Map<string, GltfNode>(collectHumanoidNodes(document));
  const missingBones = VRM_REQUIRED_HUMAN_BONE_NAMES.filter(
    (bone) => !nodesByBone.has(bone),
  );
  if (missingBones.length > 0) {
    throw new Error(
      `Cannot author VRM: missing required humanoid bones ${missingBones.join(", ")}.`,
    );
  }

  for (const [bone, node] of nodesByBone) {
    writableExtension.humanoidBoneNodes.set(bone, node);
  }

  writableExtension.data = {
    specVersion: "1.0",
    meta: buildOpenLicenseMeta(metadata),
    humanoid: {
      humanBones: Object.fromEntries(
        [...nodesByBone.keys()].map((bone) => [bone, {}]),
      ),
    },
  };

  assertVRMDocument(document);
  const io = createVRMWebIO();
  const bytes = await writeVRM(io, document);
  assertVRMDocument(await createVRMWebIO().readBinary(bytes));
  return bytes;
}

function preserveTextureSamplers(extension: WritableVRMExtension) {
  // gltf-transform-vrm-extensions 0.1.6 initializes a newly-authored
  // VRMCVRM sampler pool as [] and overwrites glTF-Transform's finished pool.
  // Capture it at write time; remove this shim once the dependency is fixed.
  const write = extension.write.bind(extension);
  extension.write = (context) => {
    extension.samplers = context.jsonDoc.json.samplers ?? [];
    return write(context);
  };
}

function buildOpenLicenseMeta(metadata: VRMAuthoringMetadata) {
  const license = getOpenAssetLicense(metadata.license);
  if (!license) {
    throw new Error(
      `Cannot author public VRM with unsupported license "${metadata.license}".`,
    );
  }

  return {
    name: metadata.name,
    version: "1.0",
    authors: [metadata.author],
    copyrightInformation: `${metadata.author}; ${license.label}`,
    references: metadata.sourceUrl ? [metadata.sourceUrl] : undefined,
    licenseUrl: VRM_LICENSE_URL,
    thirdPartyLicenses: `${license.label}: ${license.url}`,
    otherLicenseUrl: license.url,
    avatarPermission: "everyone",
    allowExcessivelyViolentUsage: true,
    allowExcessivelySexualUsage: true,
    commercialUsage: "corporation",
    allowPoliticalOrReligiousUsage: true,
    allowAntisocialOrHateUsage: true,
    creditNotation: license.attributionRequired ? "required" : "unnecessary",
    allowRedistribution: true,
    modification: "allowModificationRedistribution",
    allowExcessivePolygonTriangle: true,
    allowExcessiveDeformation: true,
    allowExcessiveTransparency: true,
    allowExcessiveBlendshapes: true,
  };
}

function createVRMWebIO() {
  return new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
}
