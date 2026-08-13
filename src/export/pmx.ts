import type { AvatarExportInput } from "@/adapters/types";
import { Quaternion } from "three";
import { DEFAULT_PARSE_BUDGET } from "@/import/parse-budget";
import { MMD_BODY_PROFILE } from "@/profiles";
import {
  bindCanonicalRotationDeltasToTargetLocal,
  bindCanonicalTranslationOffsetsToTargetLocal,
  createCanonicalToTargetWorldCorrection,
  normalizeMotionTime,
  sampleMotionClipPose,
  type HumanoidBoneName,
} from "@/retarget";
import { GrowableBuffer } from "@/parsers/binary-writer";
import {
  PMXBinaryReader,
  readPMXHeader,
  skipPMXWeight,
  type PMXEncoding,
} from "@/parsers/pmx-binary";
import { resolveExportBoneName } from "./bone-naming";

type PMXLayout = {
  version: number;
  encoding: PMXEncoding;
  boneIndexSize: number;
  vertexIndexSize: number;
  materialIndexSize: number;
  morphIndexSize: number;
  rigidBodyIndexSize: number;
  bones: string[];
  bonePositions: Array<[number, number, number]>;
  boneSectionEnd: number;
  originalMorphCount: number;
  originalMorphDataStart: number;
  originalMorphDataEnd: number;
  optionalSectionCounts: PMXOptionalSectionCounts;
};

type PMXIndexSizes = Pick<
  PMXLayout,
  | "boneIndexSize"
  | "vertexIndexSize"
  | "materialIndexSize"
  | "morphIndexSize"
  | "rigidBodyIndexSize"
>;

type PMXOptionalSectionCounts = {
  displayFrames: number;
  rigidBodies: number;
  joints: number;
  softBodies: number;
};

type BoneFrameOffset = {
  boneIndex: number;
  translation: [number, number, number];
  rotation: [number, number, number, number];
};

export async function exportAnimatedPMX({ avatarFile, clip }: AvatarExportInput) {
  if (!avatarFile) {
    throw new Error("Animated PMX export requires a PMX avatar file.");
  }
  if (!avatarFile.name.toLowerCase().endsWith(".pmx")) {
    throw new Error("Animated PMX export currently requires a .pmx avatar file.");
  }

  const pmxBytes = new Uint8Array(await avatarFile.arrayBuffer());
  return writeAnimatedPMX(pmxBytes, clip);
}

export function writeAnimatedPMX(
  pmxBytes: Uint8Array,
  clip: AvatarExportInput["clip"],
) {
  const layout = parsePMXLayout(pmxBytes);
  const frames = collectFrameOffsets(layout, clip);
  if (frames.length === 0) {
    throw new Error("PMX avatar does not contain bones mapped by the motion clip.");
  }
  const writer = new PMXWriter(layout.encoding);
  writer.writeBytes(pmxBytes.slice(0, layout.boneSectionEnd));
  writer.writeInt32(layout.originalMorphCount + frames.length);
  writer.writeBytes(
    pmxBytes.slice(layout.originalMorphDataStart, layout.originalMorphDataEnd),
  );
  writeMotionMorphRecords(writer, layout, frames);
  writer.writeBytes(pmxBytes.slice(layout.originalMorphDataEnd));
  return writer.toUint8Array();
}

export function readAnimatedPMXMotionSummary(bytes: Uint8Array) {
  const layout = parsePMXLayout(bytes);
  const reader = new PMXBinaryReader(bytes);
  reader.offset = layout.boneSectionEnd;
  const morphCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMorphs,
    label: "PMX morphs",
  });
  const morphNames: string[] = [];
  for (let morph = 0; morph < morphCount; morph += 1) {
    const name = reader.readText(layout.encoding);
    morphNames.push(name);
    reader.readText(layout.encoding);
    reader.readUint8();
    const type = reader.readUint8();
    const offsetCount = reader.readCount({
      max: DEFAULT_PARSE_BUDGET.maxTotalSamples,
      label: "PMX morph offsets",
    });
    skipMorphOffsets(reader, type, offsetCount, layout);
  }
  return {
    morphCount,
    morphNames,
    ...layout.optionalSectionCounts,
  };
}

export function validateAnimatedPMXBytes(bytes: Uint8Array) {
  const summary = readAnimatedPMXMotionSummary(bytes);
  if (summary.morphCount === 0) {
    throw new Error("Animated PMX export does not contain motion morphs.");
  }
}

function writeMotionMorphRecords(
  writer: PMXWriter,
  layout: PMXLayout,
  frames: readonly BoneFrameOffset[][],
) {
  frames.forEach((offsets, index) => {
    const name = `3DR Frame ${String(index).padStart(4, "0")}`;
    writer.writeText(name);
    writer.writeText(name);
    writer.writeUint8(4); // other panel
    writer.writeUint8(2); // bone morph
    writer.writeInt32(offsets.length);
    for (const offset of offsets) {
      writer.writeIndex(offset.boneIndex, layout.boneIndexSize);
      offset.translation.forEach((value) => writer.writeFloat32(value));
      offset.rotation.forEach((value) => writer.writeFloat32(value));
    }
  });
}

// Morph frames are sampled at MMD's 30 FPS timeline so "3DR Frame NNNN"
// names line up with the frame numbers a paired VMD export would use.
const PMX_MORPH_FPS = 30;

function collectFrameOffsets(
  layout: PMXLayout,
  clip: AvatarExportInput["clip"],
) {
  const boundClip = bindCanonicalClipToPMXTarget(layout, clip);
  const boneLookup = new Map(layout.bones.map((name, index) => [name, index]));
  const mappedBones = [...new Set(boundClip.tracks.map((track) => track.bone))]
    .map((bone) => ({
      bone,
      boneIndex: boneLookup.get(resolveExportBoneName(bone, "mmd")),
    }))
    .filter(
      (item): item is { bone: HumanoidBoneName; boneIndex: number } =>
        item.boneIndex !== undefined,
    );
  if (mappedBones.length === 0) {
    return [];
  }

  const frameCount = Math.max(2, Math.ceil(clip.duration * PMX_MORPH_FPS) + 1);
  if (frameCount * mappedBones.length > 2_000_000) {
    throw new Error("PMX pose-morph export exceeds the 2,000,000-offset safe limit.");
  }
  const frames: BoneFrameOffset[][] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = normalizeMotionTime(frame / PMX_MORPH_FPS, boundClip.duration, false);
    const pose = sampleMotionClipPose(boundClip, time, false);
    frames.push(
      mappedBones.map(({ bone, boneIndex }) => ({
        boneIndex,
        translation: toMMDPosition(pose[bone]?.position),
        rotation: toMMDRotation(pose[bone]?.rotation),
      })),
    );
  }
  return frames;
}

function bindCanonicalClipToPMXTarget(
  layout: PMXLayout,
  clip: AvatarExportInput["clip"],
) {
  const boneLookup = new Map(layout.bones.map((name, index) => [name, index]));
  const hipsIndex = boneLookup.get(resolveExportBoneName("hips", "mmd"));
  const targetRestHipsHeight = hipsIndex === undefined
    ? undefined
    : Math.abs(layout.bonePositions[hipsIndex]?.[1] ?? 0);
  const sourceRestHipsHeight = clip.metadata?.restHipsHeight;
  const rootScale =
    targetRestHipsHeight && sourceRestHipsHeight && sourceRestHipsHeight > 0
      ? targetRestHipsHeight / sourceRestHipsHeight
      : 1;
  const canonicalToTargetWorld = createCanonicalToTargetWorldCorrection(
    MMD_BODY_PROFILE,
  );
  const parentWorldQuaternionInverse = new Quaternion();
  return {
    ...clip,
    tracks: clip.tracks.flatMap((track) => {
      if (track.path === "rotation") {
        return [{
          ...track,
          values: bindCanonicalRotationDeltasToTargetLocal(
            track.values,
            parentWorldQuaternionInverse,
            canonicalToTargetWorld,
          ),
        }];
      }
      if (track.bone !== "hips") return [];
      if (
        clip.metadata?.rootTranslationSpace === "offset-source-units" &&
        !(sourceRestHipsHeight && sourceRestHipsHeight > 0)
      ) {
        return [];
      }
      return [{
        ...track,
        values: bindCanonicalTranslationOffsetsToTargetLocal(
          track.values,
          parentWorldQuaternionInverse,
          canonicalToTargetWorld,
          rootScale,
        ),
      }];
    }),
  };
}

function parsePMXLayout(bytes: Uint8Array): PMXLayout {
  const reader = new PMXBinaryReader(bytes);
  const { version, config } = readPMXHeader(reader);
  const {
    encoding,
    additionalUvCount,
    vertexIndexSize,
    textureIndexSize,
    materialIndexSize,
    boneIndexSize,
    morphIndexSize,
    rigidBodyIndexSize,
  } = config;

  reader.readText(encoding);
  reader.readText(encoding);
  reader.readText(encoding);
  reader.readText(encoding);

  const vertexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxVertices,
    label: "PMX vertices",
  });
  for (let index = 0; index < vertexCount; index += 1) {
    reader.skip(3 * 4 + 3 * 4 + 2 * 4 + additionalUvCount * 16);
    skipPMXWeight(reader, boneIndexSize);
    reader.readFloat32();
  }

  const indexCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxIndices,
    label: "PMX indices",
  });
  reader.skip(indexCount * vertexIndexSize);

  const textureCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMX textures",
  });
  for (let index = 0; index < textureCount; index += 1) {
    reader.readText(encoding);
  }

  const materialCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMaterials,
    label: "PMX materials",
  });
  for (let index = 0; index < materialCount; index += 1) {
    reader.readText(encoding);
    reader.readText(encoding);
    reader.skip(4 * 4 + 3 * 4 + 4 + 3 * 4 + 1 + 4 * 4 + 4);
    reader.readIndex(textureIndexSize);
    reader.readIndex(textureIndexSize);
    reader.readUint8();
    if (reader.readUint8() === 0) {
      reader.readIndex(textureIndexSize);
    } else {
      reader.readUint8();
    }
    reader.readText(encoding);
    reader.readCount({
      max: DEFAULT_PARSE_BUDGET.maxIndices,
      label: "PMX material indices",
    });
  }

  const boneCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxBones,
    label: "PMX bones",
  });
  const bones: string[] = [];
  const bonePositions: Array<[number, number, number]> = [];
  for (let index = 0; index < boneCount; index += 1) {
    const boneName = reader.readText(encoding) || `PMX Bone ${index + 1}`;
    reader.readText(encoding);
    const position: [number, number, number] = [
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
    ];
    reader.readIndex(boneIndexSize);
    reader.readInt32();
    const flags = reader.readUint16();
    if (flags & 0x0001) {
      reader.readIndex(boneIndexSize);
    } else {
      reader.skip(3 * 4);
    }
    if (flags & 0x0100 || flags & 0x0200) {
      reader.readIndex(boneIndexSize);
      reader.readFloat32();
    }
    if (flags & 0x0400) {
      reader.skip(3 * 4);
    }
    if (flags & 0x0800) {
      reader.skip(6 * 4);
    }
    if (flags & 0x2000) {
      reader.readInt32();
    }
    if (flags & 0x0020) {
      reader.readIndex(boneIndexSize);
      reader.readInt32();
      reader.readFloat32();
      const linkCount = reader.readCount({
        max: DEFAULT_PARSE_BUDGET.maxBones,
        label: "PMX IK links",
      });
      for (let link = 0; link < linkCount; link += 1) {
        reader.readIndex(boneIndexSize);
        if (reader.readUint8()) {
          reader.skip(6 * 4);
        }
      }
    }
    bones.push(boneName);
    bonePositions.push(position);
  }

  const boneSectionEnd = reader.offset;
  const originalMorphCount = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxMorphs,
    label: "PMX morphs",
  });
  const originalMorphDataStart = reader.offset;
  for (let morph = 0; morph < originalMorphCount; morph += 1) {
    reader.readText(encoding);
    reader.readText(encoding);
    reader.readUint8();
    const type = reader.readUint8();
    const offsetCount = reader.readCount({
      max: DEFAULT_PARSE_BUDGET.maxTotalSamples,
      label: "PMX morph offsets",
    });
    skipMorphOffsets(reader, type, offsetCount, {
      boneIndexSize,
      vertexIndexSize,
      materialIndexSize,
      morphIndexSize,
      rigidBodyIndexSize,
    });
  }
  const originalMorphDataEnd = reader.offset;
  const optionalSectionCounts = readOptionalSectionCounts(reader, {
    version,
    encoding,
    boneIndexSize,
    vertexIndexSize,
    materialIndexSize,
    morphIndexSize,
    rigidBodyIndexSize,
  });
  if (reader.remaining !== 0) {
    throw new Error(`PMX file has ${reader.remaining} unexpected trailing bytes.`);
  }

  return {
    version,
    encoding,
    boneIndexSize,
    vertexIndexSize,
    materialIndexSize,
    morphIndexSize,
    rigidBodyIndexSize,
    bones,
    bonePositions,
    boneSectionEnd,
    originalMorphCount,
    originalMorphDataStart,
    originalMorphDataEnd,
    optionalSectionCounts,
  };
}

function skipMorphOffsets(
  reader: PMXBinaryReader,
  type: number,
  count: number,
  layout: PMXIndexSizes,
) {
  for (let index = 0; index < count; index += 1) {
    if (type === 0) {
      reader.readIndex(layout.morphIndexSize);
      reader.readFloat32();
    } else if (type === 1) {
      reader.readUnsignedIndex(layout.vertexIndexSize);
      reader.skip(3 * 4);
    } else if (type === 2) {
      reader.readIndex(layout.boneIndexSize);
      reader.skip(3 * 4 + 4 * 4);
    } else if (type === 3 || type === 4 || type === 5 || type === 6 || type === 7) {
      reader.readUnsignedIndex(layout.vertexIndexSize);
      reader.skip(4 * 4);
    } else if (type === 8) {
      reader.readIndex(layout.materialIndexSize);
      reader.readUint8();
      reader.skip(4 * 4 + 3 * 4 + 4 + 3 * 4 + 4 * 4 + 4 + 4 * 4 + 4 * 4 + 4 * 4);
    } else if (type === 9) {
      reader.readIndex(layout.morphIndexSize);
      reader.readFloat32();
    } else if (type === 10) {
      reader.readIndex(layout.rigidBodyIndexSize);
      reader.readUint8();
      reader.skip(6 * 4);
    } else {
      throw new Error(`Unsupported PMX morph type: ${type}`);
    }
  }
}

function readOptionalSectionCounts(
  reader: PMXBinaryReader,
  layout: PMXIndexSizes & { version: number; encoding: PMXEncoding },
): PMXOptionalSectionCounts {
  const displayFrames = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxBones,
    label: "PMX display frames",
  });
  for (let frame = 0; frame < displayFrames; frame += 1) {
    reader.readText(layout.encoding);
    reader.readText(layout.encoding);
    reader.readUint8();
    const elementCount = reader.readCount({
      max: DEFAULT_PARSE_BUDGET.maxTotalSamples,
      label: "PMX display elements",
    });
    for (let element = 0; element < elementCount; element += 1) {
      const type = reader.readUint8();
      if (type === 0) {
        reader.readIndex(layout.boneIndexSize);
      } else if (type === 1) {
        reader.readIndex(layout.morphIndexSize);
      } else {
        throw new Error(`Unsupported PMX display element type: ${type}.`);
      }
    }
  }

  const rigidBodies = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxBones,
    label: "PMX rigid bodies",
  });
  for (let rigidBody = 0; rigidBody < rigidBodies; rigidBody += 1) {
    reader.readText(layout.encoding);
    reader.readText(layout.encoding);
    reader.readIndex(layout.boneIndexSize);
    reader.readUint8();
    reader.readUint16();
    reader.readUint8();
    reader.skip(3 * 4 + 3 * 4 + 3 * 4 + 5 * 4 + 1);
  }

  const joints = reader.readCount({
    max: DEFAULT_PARSE_BUDGET.maxBones,
    label: "PMX joints",
  });
  for (let joint = 0; joint < joints; joint += 1) {
    reader.readText(layout.encoding);
    reader.readText(layout.encoding);
    reader.readUint8();
    reader.readIndex(layout.rigidBodyIndexSize);
    reader.readIndex(layout.rigidBodyIndexSize);
    reader.skip(8 * 3 * 4);
  }

  let softBodies = 0;
  if (layout.version >= 2.1) {
    softBodies = reader.readCount({
      max: DEFAULT_PARSE_BUDGET.maxMaterials,
      label: "PMX soft bodies",
    });
    for (let softBody = 0; softBody < softBodies; softBody += 1) {
      reader.readText(layout.encoding);
      reader.readText(layout.encoding);
      reader.readUint8();
      reader.readIndex(layout.materialIndexSize);
      reader.readUint8();
      reader.readUint16();
      reader.readUint8();
      reader.readInt32();
      reader.readInt32();
      reader.skip(2 * 4);
      reader.readInt32();
      reader.skip(12 * 4 + 6 * 4 + 4 * 4 + 3 * 4);
      const anchorCount = reader.readCount({
        max: DEFAULT_PARSE_BUDGET.maxTotalSamples,
        label: "PMX soft-body anchors",
      });
      for (let anchor = 0; anchor < anchorCount; anchor += 1) {
        reader.readIndex(layout.rigidBodyIndexSize);
        reader.readUnsignedIndex(layout.vertexIndexSize);
        reader.readUint8();
      }
      const pinCount = reader.readCount({
        max: DEFAULT_PARSE_BUDGET.maxTotalSamples,
        label: "PMX soft-body pins",
      });
      for (let pin = 0; pin < pinCount; pin += 1) {
        reader.readUnsignedIndex(layout.vertexIndexSize);
      }
    }
  }
  return { displayFrames, rigidBodies, joints, softBodies };
}

function toMMDPosition(
  position: readonly number[] | undefined,
): [number, number, number] {
  return [position?.[0] ?? 0, position?.[1] ?? 0, -(position?.[2] ?? 0)];
}

function toMMDRotation(
  rotation: readonly number[] | undefined,
): [number, number, number, number] {
  return [
    -(rotation?.[0] ?? 0),
    -(rotation?.[1] ?? 0),
    rotation?.[2] ?? 0,
    rotation?.[3] ?? 1,
  ];
}

class PMXWriter {
  private buf = new GrowableBuffer();
  private encoder = new TextEncoder();

  constructor(private encoding: PMXEncoding) {}

  writeText(value: string) {
    const encoded = this.encoding === "utf-16le"
      ? encodeUTF16LE(value)
      : this.encoder.encode(value);
    this.buf.writeInt32(encoded.length);
    this.buf.writeBytes(encoded);
  }

  writeBytes(value: Uint8Array) {
    this.buf.writeBytes(value);
  }

  writeUint8(value: number) {
    this.buf.writeUint8(value);
  }

  writeInt32(value: number) {
    this.buf.writeInt32(value);
  }

  writeFloat32(value: number) {
    this.buf.writeFloat32(value);
  }

  writeIndex(value: number, size: number) {
    if (size === 1) {
      this.buf.writeInt8(value);
    } else if (size === 2) {
      this.buf.writeInt16(value);
    } else {
      this.buf.writeInt32(value);
    }
  }

  toUint8Array() {
    return this.buf.toUint8Array();
  }
}

function encodeUTF16LE(value: string) {
  const output = new Uint8Array(value.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true);
  }
  return output;
}
