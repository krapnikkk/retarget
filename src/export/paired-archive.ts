import type { MotionExportFormatId } from "@/formats";
import { listAssetPackageEntries } from "@/import/asset-package";
import {
  assertHumanoidTargetIdentity,
  type RetargetedMotionClip,
  type TargetBoundSolvedHumanoidMotionClip,
} from "@/retarget";
import { WebIO } from "@gltf-transform/core";
import { readAvatarAsGLBDocument } from "./avatar-conversion";
import { collectHumanoidNodes } from "./avatar-glb";
import { createGLTFHumanoidRigSignature } from "./gltf-target-binding";
import type { BoneNamingOptions } from "./bone-naming";
import { exportBVH } from "./bvh";
import { exportFBXAnimation } from "./fbx";
import { exportGLTFAnimation } from "./gltf-animation";
import { validateMotionExportReload } from "./reload-validation";
import { exportVMD } from "./vmd";
import { exportVRMA } from "./vrma";
import { createZipArchive, createZipArchiveBlob } from "./zip";
import {
  readBlobArrayBufferWithSignal,
  readFileArrayBufferWithSignal,
} from "@/browser/read-file";

export type PairedMotionExportFormatId = Extract<
  MotionExportFormatId,
  "vrma" | "gltf-animation" | "bvh" | "vmd" | "fbx-animation"
>;

export type PairedAvatarMotionZipInput = BoneNamingOptions & {
  avatarFile: File;
  clip: TargetBoundSolvedHumanoidMotionClip;
  motionFormat: PairedMotionExportFormatId;
};

export async function exportPairedAvatarMotionZip({
  avatarFile,
  boneNamingProfile,
  clip,
  motionFormat,
}: PairedAvatarMotionZipInput) {
  await assertPairedAvatarIdentity(avatarFile, clip);
  const options: BoneNamingOptions = { boneNamingProfile };
  const motionBytes = await exportPairedMotion(clip, motionFormat, options);
  const validation = await validateMotionExportReload(motionFormat, motionBytes);
  if (!validation.ok) {
    throw new Error(
      validation.issue ?? "Paired motion export reload validation failed.",
    );
  }

  const avatarBytes = new Uint8Array(
    await readFileArrayBufferWithSignal(
      avatarFile,
      "avatar",
    ),
  );
  const baseName = sanitizeFilename(clip.name || "retargeted-motion");
  const packageEntries = listAssetPackageEntries(avatarFile);
  if (!packageEntries) {
    return createZipArchive([
      {
        name: `avatar${getFileExtension(avatarFile.name)}`,
        bytes: avatarBytes,
      },
      {
        name: `${baseName}${getMotionExtension(motionFormat)}`,
        bytes: motionBytes,
      },
    ]);
  }

  const motionName = createPackageMotionName(
    packageEntries.map((entry) => entry.name),
    baseName,
    getMotionExtension(motionFormat),
  );
  const sourceEntries = await Promise.all(
    packageEntries.map(async (entry) => ({
      name: entry.name,
      bytes: new Uint8Array(
        await readBlobArrayBufferWithSignal(
          entry.blob,
          `resource:${entry.name}`,
        ),
      ),
    })),
  );
  return createZipArchive([
    ...sourceEntries,
    { name: motionName, bytes: motionBytes },
  ]);
}

export async function exportPairedAvatarMotionZipBlob({
  avatarFile,
  boneNamingProfile,
  clip,
  motionFormat,
}: PairedAvatarMotionZipInput) {
  await assertPairedAvatarIdentity(avatarFile, clip);
  const options: BoneNamingOptions = { boneNamingProfile };
  const motionBytes = await exportPairedMotion(clip, motionFormat, options);
  const validation = await validateMotionExportReload(motionFormat, motionBytes);
  if (!validation.ok) {
    throw new Error(
      validation.issue ?? "Paired motion export reload validation failed.",
    );
  }
  const baseName = sanitizeFilename(clip.name || "retargeted-motion");
  const packageEntries = listAssetPackageEntries(avatarFile);
  if (packageEntries) {
    const motionName = createPackageMotionName(
      packageEntries.map((entry) => entry.name),
      baseName,
      getMotionExtension(motionFormat),
    );
    return createZipArchiveBlob([
      ...packageEntries.map((entry) => ({
        name: entry.name,
        blob: entry.blob,
      })),
      {
        name: motionName,
        blob: new Blob([motionBytes.slice().buffer as ArrayBuffer]),
      },
    ]);
  }
  return createZipArchiveBlob([
    {
      name: `avatar${getFileExtension(avatarFile.name)}`,
      blob: avatarFile,
    },
    {
      name: `${baseName}${getMotionExtension(motionFormat)}`,
      blob: new Blob([motionBytes.slice().buffer as ArrayBuffer]),
    },
  ]);
}

async function assertPairedAvatarIdentity(
  avatarFile: File,
  clip: TargetBoundSolvedHumanoidMotionClip,
) {
  const document = await readAvatarAsGLBDocument({
    avatarFile,
    io: new WebIO(),
  });
  const nodes = collectHumanoidNodes(document);
  assertHumanoidTargetIdentity(
    clip,
    createGLTFHumanoidRigSignature(
      nodes,
      clip.target.profile ?? "unknown",
    ),
  );
}

function exportPairedMotion(
  clip: RetargetedMotionClip,
  motionFormat: PairedMotionExportFormatId,
  options: BoneNamingOptions,
) {
  if (motionFormat === "vrma") {
    return exportVRMA(clip, options);
  }
  if (motionFormat === "gltf-animation") {
    return exportGLTFAnimation(clip, options);
  }
  if (motionFormat === "vmd") {
    return exportVMD(clip);
  }
  if (motionFormat === "fbx-animation") {
    return exportFBXAnimation(clip, options);
  }
  return exportBVH(clip, options);
}

function getMotionExtension(motionFormat: PairedMotionExportFormatId) {
  if (motionFormat === "vrma") {
    return ".vrma";
  }
  if (motionFormat === "gltf-animation") {
    return ".animation.glb";
  }
  if (motionFormat === "vmd") {
    return ".vmd";
  }
  if (motionFormat === "fbx-animation") {
    return ".fbx";
  }
  return ".bvh";
}

function getFileExtension(filename: string) {
  const match = filename.match(/(\.[^.]+)$/);
  return match?.[1] ?? "";
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "retargeted-motion";
}

function createPackageMotionName(
  sourceNames: readonly string[],
  baseName: string,
  extension: string,
) {
  const occupied = new Set(sourceNames.map((name) => name.toLowerCase()));
  const stem = `motion/${baseName}`;
  let candidate = `${stem}${extension}`;
  let suffix = 2;
  while (occupied.has(candidate.toLowerCase())) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}
