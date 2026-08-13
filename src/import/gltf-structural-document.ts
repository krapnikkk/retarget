import { Document } from "@gltf-transform/core";
import { readGLTFRigMetadata } from "./glb-range";

export async function readGLTFStructuralDocument(file: Blob) {
  const metadata = await readGLTFRigMetadata(file);
  const document = new Document();
  const nodes = metadata.nodes.map((definition, index) => {
    const node = document.createNode(
      typeof definition.name === "string" ? definition.name : `node-${index}`,
    );
    if (isNumberArray(definition.matrix, 16)) {
      node.setMatrix(definition.matrix as Parameters<typeof node.setMatrix>[0]);
    }
    else {
      if (isNumberArray(definition.translation, 3)) {
        node.setTranslation(definition.translation as Parameters<typeof node.setTranslation>[0]);
      }
      if (isNumberArray(definition.rotation, 4)) {
        node.setRotation(definition.rotation as Parameters<typeof node.setRotation>[0]);
      }
      if (isNumberArray(definition.scale, 3)) {
        node.setScale(definition.scale as Parameters<typeof node.setScale>[0]);
      }
    }
    return node;
  });
  const childIndices = new Set<number>();
  for (const [index, definition] of metadata.nodes.entries()) {
    for (const childIndex of toIndexArray(definition.children)) {
      if (nodes[childIndex] && childIndex !== index) {
        nodes[index]!.addChild(nodes[childIndex]!);
        childIndices.add(childIndex);
      }
    }
  }
  const sceneDefinitions = Array.isArray(metadata.json.scenes)
    ? metadata.json.scenes as Array<Record<string, unknown>>
    : [];
  const scenes = sceneDefinitions.map((definition, index) => {
    const scene = document.createScene(
      typeof definition.name === "string" ? definition.name : `scene-${index}`,
    );
    for (const nodeIndex of toIndexArray(definition.nodes)) {
      if (nodes[nodeIndex]) scene.addChild(nodes[nodeIndex]!);
    }
    return scene;
  });
  if (scenes.length === 0) {
    const scene = document.createScene("structural-scene");
    for (const [index, node] of nodes.entries()) {
      if (!childIndices.has(index)) scene.addChild(node);
    }
    scenes.push(scene);
  }
  const defaultSceneIndex = Number.isInteger(metadata.json.scene)
    ? metadata.json.scene as number
    : 0;
  document.getRoot().setDefaultScene(scenes[defaultSceneIndex] ?? scenes[0]!);
  for (const [index, definition] of metadata.skins.entries()) {
    const skin = document.createSkin(
      typeof definition.name === "string" ? definition.name : `skin-${index}`,
    );
    for (const jointIndex of toIndexArray(definition.joints)) {
      if (nodes[jointIndex]) skin.addJoint(nodes[jointIndex]!);
    }
    if (Number.isInteger(definition.skeleton) && nodes[definition.skeleton as number]) {
      skin.setSkeleton(nodes[definition.skeleton as number]!);
    }
  }
  return { document, metadata };
}

function toIndexArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item) && item >= 0)
    : [];
}

function isNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}
