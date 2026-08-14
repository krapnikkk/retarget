import type { Document, Node } from "@gltf-transform/core";
import { Quaternion, Vector3 } from "three";
import {
  getRequiredRigRoles,
  getRigDefinition,
} from "./definitions";
import {
  getSemanticRigProfile,
  SEMANTIC_RIG_PROFILES,
} from "./profiles";
import type {
  RigDefinition,
  RigFamilyId,
  RigRoleId,
  RigTopologyConflict,
  SemanticRigProfile,
} from "./types";
import type { Quat, RigRestTransform, Vec3 } from "@/rig-motion/types";

export type RigInspectionOptions = {
  familyOverride?: RigFamilyId | "auto";
  profileId?: string | "auto";
  roleOverrides?: Readonly<Record<RigRoleId, string>>;
};

export type RigInspection = {
  definition: RigDefinition;
  profile: SemanticRigProfile;
  nodesByRole: Map<RigRoleId, Node>;
  rolesByNode: Map<Node, RigRoleId>;
  restPose: RigRestTransform[];
  signature: string;
  missingRequiredRoles: RigRoleId[];
  unmappedNodes: string[];
  requiredChainCoverage: number;
  topologyConflicts: RigTopologyConflict[];
  axisWarnings: RigRoleId[];
};

export function inspectGLTFRig(
  document: Document,
  options: RigInspectionOptions = {},
): RigInspection {
  const candidates = collectCandidateNodes(document);
  const profile = selectProfile(candidates, options);
  const definition = getRigDefinition(profile.rigDefinitionId);
  if (!definition) {
    throw new Error(`Unsupported rig definition: ${profile.rigDefinitionId}.`);
  }
  const nodesByRole = mapNodesToRoles(candidates, profile, options.roleOverrides);
  const rolesByNode = new Map<Node, RigRoleId>();
  for (const [role, node] of nodesByRole) {
    rolesByNode.set(node, role);
  }
  const missingRequiredRoles = getRequiredRigRoles(definition).filter(
    (role) => !nodesByRole.has(role),
  );
  const restPose = createRestPose(definition, nodesByRole, rolesByNode);
  const unmappedNodes = candidates
    .filter((node) => !rolesByNode.has(node))
    .map((node) => node.getName() || "(unnamed)");

  const topologyConflicts = findTopologyConflicts(
    definition,
    restPose,
    nodesByRole,
  );
  const axisWarnings = restPose
    .filter(
      (transform) =>
        !transform.primaryAxis &&
        definition.roles.some(
          (role) => role.parent === transform.role && nodesByRole.has(role.id),
        ),
    )
    .map((transform) => transform.role);

  return {
    definition,
    profile,
    nodesByRole,
    rolesByNode,
    restPose,
    signature: createRigSignature(document, definition, restPose, nodesByRole),
    missingRequiredRoles,
    unmappedNodes,
    requiredChainCoverage: calculateRequiredChainCoverage(
      definition,
      nodesByRole,
    ),
    topologyConflicts,
    axisWarnings,
  };
}

export function normalizeRigNodeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^mixamorig[:_\s-]*/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function selectProfile(
  nodes: readonly Node[],
  options: RigInspectionOptions,
) {
  if (options.profileId && options.profileId !== "auto") {
    const profile = getSemanticRigProfile(options.profileId);
    if (!profile) {
      throw new Error(`Unknown rig profile: ${options.profileId}.`);
    }
    if (
      options.familyOverride &&
      options.familyOverride !== "auto" &&
      profile.family !== options.familyOverride
    ) {
      throw new Error(
        `Rig profile ${profile.id} does not belong to ${options.familyOverride}.`,
      );
    }
    return profile;
  }

  const profiles = SEMANTIC_RIG_PROFILES.filter(
    (profile) =>
      !options.familyOverride ||
      options.familyOverride === "auto" ||
      profile.family === options.familyOverride,
  );
  const scored = profiles
    .map((profile) => ({ profile, ...scoreProfile(profile, nodes) }))
    .sort(
      (left, right) =>
        right.requiredRatio - left.requiredRatio ||
        right.mappedRoles - left.mappedRoles,
    );
  const best = scored[0];
  if (!best || best.mappedRoles === 0) {
    throw new Error("No supported rig profile could map this glTF skeleton.");
  }
  return best.profile;
}

function scoreProfile(profile: SemanticRigProfile, nodes: readonly Node[]) {
  const definition = getRigDefinition(profile.rigDefinitionId);
  if (!definition) {
    return { mappedRoles: 0, requiredRatio: 0 };
  }
  const mapping = mapNodesToRoles(nodes, profile);
  const required = getRequiredRigRoles(definition);
  const mappedRequired = required.filter((role) => mapping.has(role)).length;
  return {
    mappedRoles: mapping.size,
    requiredRatio: required.length > 0 ? mappedRequired / required.length : 0,
  };
}

function mapNodesToRoles(
  nodes: readonly Node[],
  profile: SemanticRigProfile,
  roleOverrides: Readonly<Record<RigRoleId, string>> = {},
) {
  const byName = new Map<string, Node[]>();
  for (const node of nodes) {
    const key = normalizeRigNodeName(node.getName());
    byName.set(key, [...(byName.get(key) ?? []), node]);
  }
  const nodesByRole = new Map<RigRoleId, Node>();
  const claimed = new Set<Node>();
  for (const profileRole of profile.roles) {
    const override = roleOverrides[profileRole.role];
    const names = override ? [override] : profileRole.aliases;
    const node = names
      .flatMap((name) => byName.get(normalizeRigNodeName(name)) ?? [])
      .find((candidate) => !claimed.has(candidate));
    if (node) {
      nodesByRole.set(profileRole.role, node);
      claimed.add(node);
    }
  }
  for (const [role, nodeName] of Object.entries(roleOverrides)) {
    if (nodesByRole.has(role)) continue;
    const node = (byName.get(normalizeRigNodeName(nodeName)) ?? []).find(
      (candidate) => !claimed.has(candidate),
    );
    if (node) {
      nodesByRole.set(role, node);
      claimed.add(node);
    }
  }
  for (const chain of profile.orderedChains ?? []) {
    const pattern = new RegExp(chain.nodePattern, "i");
    const matched = nodes
      .map((node) => ({ node, match: pattern.exec(node.getName().trim()) }))
      .filter(
        (item): item is { node: Node; match: RegExpExecArray } =>
          Boolean(item.match) && !claimed.has(item.node),
      )
      .sort((left, right) => {
        const leftOrder = Number(left.match[1]);
        const rightOrder = Number(right.match[1]);
        return Number.isFinite(leftOrder) && Number.isFinite(rightOrder)
          ? leftOrder - rightOrder
          : left.node.getName().localeCompare(right.node.getName());
      });
    matched.forEach(({ node }, index) => {
      const roleIndex =
        matched.length <= 1
          ? 0
          : Math.round((index * (chain.roles.length - 1)) / (matched.length - 1));
      const role = chain.roles[roleIndex];
      if (role && !nodesByRole.has(role)) {
        nodesByRole.set(role, node);
        claimed.add(node);
      }
    });
  }
  return nodesByRole;
}

function findTopologyConflicts(
  definition: RigDefinition,
  restPose: readonly RigRestTransform[],
  nodesByRole: ReadonlyMap<RigRoleId, Node>,
) {
  const roleDefinitions = new Map(
    definition.roles.map((role) => [role.id, role]),
  );
  return restPose.flatMap((transform): RigTopologyConflict[] => {
    let expectedParentRole = roleDefinitions.get(transform.role)?.parent;
    while (expectedParentRole && !nodesByRole.has(expectedParentRole)) {
      expectedParentRole = roleDefinitions.get(expectedParentRole)?.parent;
    }
    if (expectedParentRole === transform.parentRole) return [];
    if (!expectedParentRole && !transform.parentRole) return [];
    return [
      {
        role: transform.role,
        ...(expectedParentRole ? { expectedParentRole } : {}),
        ...(transform.parentRole
          ? { actualParentRole: transform.parentRole }
          : {}),
      },
    ];
  });
}

function collectCandidateNodes(document: Document) {
  const candidates = new Set<Node>();
  for (const skin of document.getRoot().listSkins()) {
    for (const joint of skin.listJoints()) {
      candidates.add(joint);
    }
  }
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      if (node) candidates.add(node);
    }
  }
  if (candidates.size === 0) {
    for (const node of document.getRoot().listNodes()) {
      if (node.listChildren().length > 0 || node.getParentNode()) {
        candidates.add(node);
      }
    }
  }
  return [...candidates];
}

function createRestPose(
  definition: RigDefinition,
  nodesByRole: ReadonlyMap<RigRoleId, Node>,
  rolesByNode: ReadonlyMap<Node, RigRoleId>,
) {
  return [...nodesByRole].map(([role, node]): RigRestTransform => {
    const child = findPrimaryChild(definition, role, nodesByRole);
    const primaryAxis = child ? getDirectionInNodeSpace(node, child) : undefined;
    return {
      role,
      nodeName: node.getName() || role,
      ...(findMappedParentRole(node, rolesByNode)
        ? { parentRole: findMappedParentRole(node, rolesByNode)! }
        : {}),
      translation: tuple3(node.getTranslation()),
      rotation: tuple4(node.getRotation()),
      worldTranslation: tuple3(node.getWorldTranslation()),
      worldRotation: tuple4(node.getWorldRotation()),
      ...(primaryAxis ? { primaryAxis } : {}),
    };
  });
}

function findPrimaryChild(
  definition: RigDefinition,
  role: RigRoleId,
  nodesByRole: ReadonlyMap<RigRoleId, Node>,
) {
  const queue = definition.roles
    .filter((candidate) => candidate.parent === role)
    .map((candidate) => candidate.id);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const candidateRole = queue.shift()!;
    if (visited.has(candidateRole)) continue;
    visited.add(candidateRole);
    const child = nodesByRole.get(candidateRole);
    if (child) return child;
    for (const descendant of definition.roles) {
      if (descendant.parent === candidateRole) {
        queue.push(descendant.id);
      }
    }
  }
  return null;
}

function getDirectionInNodeSpace(node: Node, child: Node): Vec3 | undefined {
  const start = new Vector3(...node.getWorldTranslation());
  const direction = new Vector3(...child.getWorldTranslation()).sub(start);
  if (direction.lengthSq() <= 1e-12) return undefined;
  const worldRotation = node.getWorldRotation();
  direction.applyQuaternion(
    new Quaternion(
      worldRotation[0],
      worldRotation[1],
      worldRotation[2],
      worldRotation[3],
    )
      .normalize()
      .invert(),
  );
  direction.normalize();
  return [direction.x, direction.y, direction.z];
}

function findMappedParentRole(
  node: Node,
  rolesByNode: ReadonlyMap<Node, RigRoleId>,
) {
  for (let parent = node.getParentNode(); parent; parent = parent.getParentNode()) {
    const role = rolesByNode.get(parent);
    if (role) return role;
  }
  return undefined;
}

function createRigSignature(
  document: Document,
  definition: RigDefinition,
  restPose: readonly RigRestTransform[],
  nodesByRole: ReadonlyMap<RigRoleId, Node>,
) {
  const serialized = restPose
    .slice()
    .sort((left, right) => left.role.localeCompare(right.role))
    .map((transform) => {
      const node = nodesByRole.get(transform.role);
      const skinEvidence = node
        ? createSkinBindingEvidence(document, node)
        : [];
      return [
        transform.role,
        transform.parentRole ?? "",
        normalizeRigNodeName(transform.nodeName),
        node ? createNodePath(node) : "",
        ...transform.translation.map(roundSignature),
        ...transform.rotation.map(roundSignature),
        ...(node?.getScale() ?? [1, 1, 1]).map(roundSignature),
        ...skinEvidence,
      ].join(":");
    })
    .join("|");
  return `${definition.id}:rest-node-skin-v2:${fnv1a(serialized)}`;
}

function createNodePath(node: Node) {
  const segments: string[] = [];
  for (let current: Node | null = node; current; current = current.getParentNode()) {
    segments.unshift(normalizeRigNodeName(current.getName()) || "(unnamed)");
  }
  return segments.join("/");
}

function createSkinBindingEvidence(document: Document, joint: Node) {
  return document
    .getRoot()
    .listSkins()
    .flatMap((skin) => {
      const jointIndex = skin.listJoints().indexOf(joint);
      if (jointIndex < 0) return [];
      const inverseBind = skin.getInverseBindMatrices();
      const inverseBindValues = inverseBind
        ? inverseBind.getElement(jointIndex, []).map(roundSignature)
        : [];
      const users = document
        .getRoot()
        .listNodes()
        .filter((node) => node.getSkin() === skin)
        .map((node) =>
          `${createNodePath(node)}#${normalizeRigNodeName(node.getMesh()?.getName() ?? "")}`,
        )
        .sort();
      return [[
        `skin=${normalizeRigNodeName(skin.getName())}`,
        `joint=${jointIndex}`,
        `inverseBind=${inverseBindValues.join(",")}`,
        `users=${users.join(",")}`,
      ].join(";")];
    })
    .sort();
}

export function calculateRequiredChainCoverage(
  definition: RigDefinition,
  nodesByRole: ReadonlyMap<RigRoleId, unknown> | ReadonlySet<RigRoleId>,
) {
  const requiredChains = definition.chains.filter((chain) => chain.required);
  if (requiredChains.length === 0) return 1;
  const total = requiredChains.reduce((coverage, chain) => {
    const mapped = chain.roles.filter((role) => nodesByRole.has(role)).length;
    const requiredCount = chain.minimumMappedRoles ?? chain.roles.length;
    return coverage + Math.min(1, mapped / requiredCount);
  }, 0);
  return total / requiredChains.length;
}

function tuple3(value: readonly number[]): Vec3 {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function tuple4(value: readonly number[]): Quat {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}

function roundSignature(value: number) {
  return Number(value.toFixed(5));
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
