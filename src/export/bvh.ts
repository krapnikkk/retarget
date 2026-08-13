import { Euler, Quaternion } from "three";
import {
  HUMANOID_BONES,
  normalizeMotionTime,
  sampleMotionClipPose,
  type HumanoidBoneName,
  type RetargetedMotionClip,
} from "@/retarget";
import { validateMotionClip } from "@/retarget";
import {
  resolveExportBoneName,
  type BoneNamingOptions,
  type BoneNamingProfileId,
} from "./bone-naming";
import { assertGeneratedExportBudget } from "@/jobs/processing-budget";

type BVHNode = {
  bone: HumanoidBoneName;
  offset: readonly [number, number, number];
  endOffset?: readonly [number, number, number];
  children: readonly BVHNode[];
};

type BVHChannelNode = {
  bone: HumanoidBoneName;
  channels: readonly string[];
};

const BVH_HUMANOID_TREE = {
  bone: "hips",
  offset: [0, 0, 0],
  children: [
    {
      bone: "spine",
      offset: [0, 0.12, 0],
      children: [
        {
          bone: "chest",
          offset: [0, 0.18, 0],
          children: [
            {
              bone: "upperChest",
              offset: [0, 0.12, 0],
              children: [
                {
                  bone: "neck",
                  offset: [0, 0.14, 0],
                  children: [
                    {
                      bone: "head",
                      offset: [0, 0.16, 0],
                      endOffset: [0, 0.14, 0],
                      children: [],
                    },
                  ],
                },
                {
                  bone: "leftShoulder",
                  offset: [-0.08, 0.1, 0],
                  children: [
                    {
                      bone: "leftUpperArm",
                      offset: [-0.18, 0, 0],
                      children: [
                        {
                          bone: "leftLowerArm",
                          offset: [-0.28, 0, 0],
                          children: [
                            {
                              bone: "leftHand",
                              offset: [-0.24, 0, 0],
                              endOffset: [-0.1, 0, 0],
                              children: [],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  bone: "rightShoulder",
                  offset: [0.08, 0.1, 0],
                  children: [
                    {
                      bone: "rightUpperArm",
                      offset: [0.18, 0, 0],
                      children: [
                        {
                          bone: "rightLowerArm",
                          offset: [0.28, 0, 0],
                          children: [
                            {
                              bone: "rightHand",
                              offset: [0.24, 0, 0],
                              endOffset: [0.1, 0, 0],
                              children: [],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      bone: "leftUpperLeg",
      offset: [-0.11, -0.08, 0],
      children: [
        {
          bone: "leftLowerLeg",
          offset: [0, -0.42, 0],
          children: [
            {
              bone: "leftFoot",
              offset: [0, -0.4, 0],
              children: [
                {
                  bone: "leftToes",
                  offset: [0, -0.05, 0.14],
                  endOffset: [0, 0, 0.08],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      bone: "rightUpperLeg",
      offset: [0.11, -0.08, 0],
      children: [
        {
          bone: "rightLowerLeg",
          offset: [0, -0.42, 0],
          children: [
            {
              bone: "rightFoot",
              offset: [0, -0.4, 0],
              children: [
                {
                  bone: "rightToes",
                  offset: [0, -0.05, 0.14],
                  endOffset: [0, 0, 0.08],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as const satisfies BVHNode;

export async function exportBVH(
  clip: RetargetedMotionClip,
  options: BoneNamingOptions = {},
): Promise<Uint8Array> {
  return new TextEncoder().encode(createBVHText(clip, options));
}

export function createBVHText(
  clip: RetargetedMotionClip,
  { boneNamingProfile = "canonical" }: BoneNamingOptions = {},
) {
  const validation = validateMotionClip(clip);
  if (!validation.ok) {
    throw new Error(validation.issues.join(" "));
  }

  const trackedBones = new Set(HUMANOID_BONES.filter((bone) =>
    clip.tracks.some((track) => track.bone === bone),
  ));
  trackedBones.add("hips");
  const channelNodes = collectChannelNodes(BVH_HUMANOID_TREE, trackedBones);
  const frameTime = 1 / Math.max(clip.fps || 30, 1);
  const frameCount = Math.max(2, Math.ceil(clip.duration / frameTime) + 1);
  const valuesPerFrame = channelNodes.reduce(
    (sum, node) => sum + node.channels.length,
    0,
  );
  assertGeneratedExportBudget({
    frameCount,
    valuesPerFrame,
    estimatedOutputBytes: frameCount * valuesPerFrame * 18,
    phase: "bvh-export",
  });
  const frameLines: string[] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = normalizeMotionTime(frame * frameTime, clip.duration, false);
    const pose = sampleMotionClipPose(clip, time, false);
    const values: number[] = [];
    for (const node of channelNodes) {
      const item = pose[node.bone];
      if (node.bone === "hips") {
        values.push(...(item?.position ?? [0, 0, 0]));
      }
      values.push(...quaternionToBVHEuler(item?.rotation));
    }
    frameLines.push(values.map((value) => round(value).toString()).join(" "));
  }

  return [
    "HIERARCHY",
    `ROOT ${formatBVHNodeName("hips", boneNamingProfile)}`,
    "{",
    "  OFFSET 0 0 0",
    "  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation",
    ...BVH_HUMANOID_TREE.children.flatMap((child) =>
      createBVHJointLines(
        child,
        trackedBones,
        1,
        estimateBVHHeightScale(clip),
        boneNamingProfile,
      ),
    ),
    "}",
    "MOTION",
    `Frames: ${frameCount}`,
    `Frame Time: ${round(frameTime)}`,
    ...frameLines,
    "",
  ].join("\n");
}

function createBVHJointLines(
  node: BVHNode,
  trackedBones: ReadonlySet<HumanoidBoneName>,
  depth: number,
  scale: number,
  boneNamingProfile: BoneNamingProfileId,
): string[] {
  if (!shouldIncludeNode(node, trackedBones)) {
    return [];
  }

  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  const lines = [
    `${indent}JOINT ${formatBVHNodeName(node.bone, boneNamingProfile)}`,
    `${indent}{`,
    `${childIndent}OFFSET ${formatOffset(node.offset, scale)}`,
    `${childIndent}CHANNELS 3 Zrotation Xrotation Yrotation`,
  ];
  for (const child of node.children) {
    lines.push(
      ...createBVHJointLines(
        child,
        trackedBones,
        depth + 1,
        scale,
        boneNamingProfile,
      ),
    );
  }
  lines.push(...createEndSiteLines(node, trackedBones, depth + 1, scale));
  lines.push(`${indent}}`);
  return lines;
}

function createEndSiteLines(
  node: BVHNode,
  trackedBones: ReadonlySet<HumanoidBoneName>,
  depth: number,
  scale: number,
) {
  if (node.children.some((child) => shouldIncludeNode(child, trackedBones))) {
    return [];
  }

  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  return [
    `${indent}End Site`,
    `${indent}{`,
    `${childIndent}OFFSET ${formatOffset(node.endOffset ?? [0, 0.08, 0], scale)}`,
    `${indent}}`,
  ];
}

function collectChannelNodes(
  node: BVHNode,
  trackedBones: ReadonlySet<HumanoidBoneName>,
): BVHChannelNode[] {
  if (!shouldIncludeNode(node, trackedBones)) {
    return [];
  }

  return [
    {
      bone: node.bone,
      channels:
        node.bone === "hips"
          ? [
              "Xposition",
              "Yposition",
              "Zposition",
              "Zrotation",
              "Xrotation",
              "Yrotation",
            ]
          : ["Zrotation", "Xrotation", "Yrotation"],
    },
    ...node.children.flatMap((child) => collectChannelNodes(child, trackedBones)),
  ];
}

function shouldIncludeNode(
  node: BVHNode,
  trackedBones: ReadonlySet<HumanoidBoneName>,
): boolean {
  return (
    node.bone === "hips" ||
    trackedBones.has(node.bone) ||
    node.children.some((child) => shouldIncludeNode(child, trackedBones))
  );
}

function estimateBVHHeightScale(clip: RetargetedMotionClip) {
  return Math.max(
    clip.metadata?.targetHeight ??
      clip.metadata?.sourceHeight ??
      clip.target.restHipsHeight ??
      1.7,
    0.1,
  );
}

function formatOffset(offset: readonly [number, number, number], scale: number) {
  return offset.map((value) => round(value * scale).toString()).join(" ");
}

function quaternionToBVHEuler(rotation?: [number, number, number, number]) {
  if (!rotation) {
    return [0, 0, 0];
  }

  const euler = new Euler().setFromQuaternion(
    new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]),
    "ZXY",
  );
  return [
    radiansToDegrees(euler.z),
    radiansToDegrees(euler.x),
    radiansToDegrees(euler.y),
  ];
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function formatBVHNodeName(
  bone: HumanoidBoneName,
  boneNamingProfile: BoneNamingProfileId,
) {
  return resolveExportBoneName(bone, boneNamingProfile);
}
