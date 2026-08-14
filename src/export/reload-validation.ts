import { WebIO } from "@gltf-transform/core";
import {
  VRMC_VRM_EXTENSIONS,
  assertVRMDocument,
} from "gltf-transform-vrm-extensions";
import type {
  AvatarExportFormatId,
  MotionExportFormatId,
} from "@/formats";
import { importBVH } from "@/import/bvh";
import { importFBXHumanoidMotionBytes } from "@/import/fbx-motion";
import { importVMD } from "@/import/vmd";
import { importVRMA } from "@/import/vrma";
import {
  GENERIC_GLTF_HUMANOID_PROFILE,
  GENERIC_FBX_HUMANOID_PROFILE,
  getRigProfile,
  type RigProfileId,
} from "@/profiles";
import { parseMotionClip, type RetargetedMotionClip } from "@/retarget";
import {
  CANONICAL_AXIS_FRAME,
  createAxisCorrection,
} from "@/retarget/coordinate-space";
import {
  DEFAULT_SEMANTIC_THRESHOLDS,
  validateHumanoidMotionSemantics,
  type SemanticMotionValidationResult,
} from "@/validation";
import { validateGLTFWorldSemantics } from "@/validation/gltf-world-semantic-oracle";
import { collectHumanoidNodes } from "./avatar-glb";
import { validateFBXAnimationBytes } from "./fbx";
import { validateAnimatedPMXBytes } from "./pmx";
import { readZipArchive } from "./zip";

export type ExportReloadValidationResult = {
  level: "structural";
  ok: boolean;
  formatId: MotionExportFormatId | AvatarExportFormatId;
  issue?: string;
};

export async function validateMotionExportReload(
  formatId: MotionExportFormatId,
  bytes: Uint8Array,
): Promise<ExportReloadValidationResult> {
  try {
    if (formatId === "vrma") {
      await importVRMA(bytes, "reload.vrma");
    } else if (formatId === "motion-json") {
      parseMotionClip(new TextDecoder().decode(bytes));
    } else if (formatId === "vmd") {
      importVMD(bytes, "reload.vmd");
    } else if (formatId === "gltf-animation") {
      const document = await new WebIO().readBinary(bytes);
      if (document.getRoot().listAnimations().length === 0) {
        throw new Error("GLB export does not contain an animation.");
      }
    } else if (formatId === "bvh") {
      importBVH(bytes, "reload.bvh");
    } else if (formatId === "fbx-animation") {
      await validateFBXAnimationBytes(bytes);
    } else {
      throw new Error("Export format does not have an active reload validator.");
    }

    return { level: "structural", ok: true, formatId };
  } catch (cause) {
    return {
      ok: false,
      level: "structural",
      formatId,
      issue: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export async function validateAvatarExportReload(
  formatId: AvatarExportFormatId,
  bytes: Uint8Array,
): Promise<ExportReloadValidationResult> {
  try {
    if (
      formatId !== "animated-glb" &&
      formatId !== "baked-vrm" &&
      formatId !== "fbx-avatar-animation" &&
      formatId !== "animated-pmx" &&
      formatId !== "vrm-external-vrma"
    ) {
      throw new Error("Avatar export format does not have an active reload validator.");
    }

    if (formatId === "vrm-external-vrma") {
      const entries = readZipArchive(bytes);
      const avatarEntry = entries.find((entry) =>
        entry.name.toLowerCase().endsWith(".vrm"),
      );
      const motionEntry = entries.find((entry) =>
        entry.name.toLowerCase().endsWith(".vrma"),
      );
      if (!avatarEntry) {
        throw new Error("VRM + VRMA bundle does not contain a .vrm avatar file.");
      }
      if (!motionEntry) {
        throw new Error("VRM + VRMA bundle does not contain a .vrma motion file.");
      }
      if (new TextDecoder().decode(avatarEntry.bytes.subarray(0, 4)) !== "glTF") {
        throw new Error("Bundled VRM avatar is not a valid GLB file.");
      }
      await importVRMA(motionEntry.bytes, "reload.vrma");
      return { level: "structural", ok: true, formatId };
    }

    if (formatId === "fbx-avatar-animation") {
      await validateFBXAnimationBytes(bytes);
      return { level: "structural", ok: true, formatId };
    }
    if (formatId === "animated-pmx") {
      validateAnimatedPMXBytes(bytes);
      return { level: "structural", ok: true, formatId };
    }

    const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
    const document = await io.readBinary(bytes);
    if (formatId === "baked-vrm") {
      assertVRMDocument(document);
    }
    if (document.getRoot().listAnimations().length === 0) {
      throw new Error("Animated GLB export does not contain an animation.");
    }

    return { level: "structural", ok: true, formatId };
  } catch (cause) {
    return {
      ok: false,
      level: "structural",
      formatId,
      issue: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export type ExportSemanticValidationResult = SemanticMotionValidationResult & {
  formatId: MotionExportFormatId | AvatarExportFormatId;
};

export type EcosystemCompatibilityValidationResult = {
  level: "ecosystem";
  ok: boolean;
  formatId: MotionExportFormatId | AvatarExportFormatId;
  ecosystem: string;
  evidence: string;
  verifiedAt: string;
  issue?: string;
};

export async function validateMotionExportSemantics(
  formatId: MotionExportFormatId,
  bytes: Uint8Array,
  expected: RetargetedMotionClip,
): Promise<ExportSemanticValidationResult> {
  let actual: RetargetedMotionClip;
  if (formatId === "vrma") {
    actual = await importVRMA(bytes, "semantic.vrma");
  } else if (formatId === "motion-json") {
    actual = parseMotionClip(new TextDecoder().decode(bytes));
  } else if (formatId === "gltf-animation") {
    const document = await new WebIO().readBinary(bytes);
    return {
      formatId,
      ...validateGLTFWorldSemantics({
        animationName: expected.name,
        document,
        expected,
        nodesByBone: collectHumanoidNodes(document),
        thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
        worldAxisCorrection: createAxisCorrection(
          CANONICAL_AXIS_FRAME,
          GENERIC_GLTF_HUMANOID_PROFILE,
        ),
      }),
    };
  } else if (formatId === "bvh") {
    actual = normalizeBoundBVHRootUnits(
      importBVH(bytes, "semantic.bvh"),
      expected,
    );
  } else if (formatId === "vmd") {
    actual = importVMD(bytes, "semantic.vmd");
  } else if (formatId === "fbx-animation") {
    actual = importFBXHumanoidMotionBytes({
      bytes: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
      filename: "semantic.fbx",
      kind: "generic-fbx",
      profile: GENERIC_FBX_HUMANOID_PROFILE,
    });
  } else {
    return unsupportedSemanticResult(formatId, "semantic import is unavailable");
  }
  return {
    formatId,
    ...validateHumanoidMotionSemantics({ actual, expected }),
  };
}

function normalizeBoundBVHRootUnits(
  actual: RetargetedMotionClip,
  expected: RetargetedMotionClip,
): RetargetedMotionClip {
  const actualHeight = actual.metadata?.restHipsHeight;
  const expectedHeight =
    expected.metadata?.targetHeight ?? expected.target.restHipsHeight;
  if (
    actual.metadata?.rootTranslationSpace !== "offset-source-units" ||
    actual.metadata.rootMotionEvidence?.status !== "preserved" ||
    actual.metadata.rootMotionEvidence.scaleSource !== "bvh-hierarchy" ||
    actualHeight === undefined ||
    expectedHeight === undefined ||
    Math.abs(actualHeight - expectedHeight) > 0.001
  ) {
    return actual;
  }
  return {
    ...actual,
    metadata: {
      ...actual.metadata,
      rootTranslationSpace: "offset-meters",
    },
  };
}

export async function validateAvatarExportSemantics(
  formatId: AvatarExportFormatId,
  bytes: Uint8Array,
  expected: RetargetedMotionClip,
): Promise<ExportSemanticValidationResult> {
  if (formatId === "animated-glb" || formatId === "baked-vrm") {
    const io = new WebIO().registerExtensions(VRMC_VRM_EXTENSIONS);
    const document = await io.readBinary(bytes);
    const nodesByBone = collectHumanoidNodes(document);
    return {
      formatId,
      ...validateGLTFWorldSemantics({
        animationName: expected.name,
        document,
        expected,
        nodesByBone,
        thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
        worldAxisCorrection: resolveWorldAxisCorrection(expected),
      }),
    };
  }
  if (formatId === "vrm-external-vrma") {
    const motionEntry = readZipArchive(bytes).find((entry) =>
      entry.name.toLowerCase().endsWith(".vrma"),
    );
    if (!motionEntry) {
      return unsupportedSemanticResult(formatId, "bundle has no VRMA motion");
    }
    const actual = await importVRMA(motionEntry.bytes, "semantic.vrma");
    return {
      formatId,
      ...validateHumanoidMotionSemantics({ actual, expected }),
    };
  }
  return unsupportedSemanticResult(
    formatId,
    `${formatId} does not yet have an independent semantic importer`,
  );
}

function resolveWorldAxisCorrection(expected: RetargetedMotionClip) {
  const profile = expected.target.profile
    ? getRigProfile(expected.target.profile as RigProfileId)
    : null;
  return profile
    ? createAxisCorrection(CANONICAL_AXIS_FRAME, profile)
    : undefined;
}

function unsupportedSemanticResult(
  formatId: MotionExportFormatId | AvatarExportFormatId,
  issue: string,
): ExportSemanticValidationResult {
  return {
    level: "semantic",
    ok: false,
    formatId,
    sampleTimes: [],
    issues: [issue],
    missingRotationTracks: [],
    metrics: {
      durationErrorSeconds: 0,
      maxRotationErrorDegrees: 0,
      maxRootDisplacementErrorMeters: 0,
      maxRootDirectionErrorDegrees: 0,
      maxEndEffectorErrorMeters: 0,
      maxSymmetryErrorMeters: 0,
    },
  };
}
