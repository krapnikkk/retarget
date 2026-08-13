import { Material, Mesh, Object3D, Texture } from "three";

export function disposeObject(object: Object3D) {
  const geometries = new Set<NonNullable<Partial<Mesh>["geometry"]>>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const imageSources = new Set<object>();
  const skeletons = new Set<{ dispose?: () => void }>();
  object.traverse((child) => {
    child.animations.length = 0;
    const mesh = child as Partial<Mesh>;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const skinnedMesh = child as unknown as {
      isSkinnedMesh?: boolean;
      skeleton?: { dispose?: () => void };
    };
    if (
      skinnedMesh.isSkinnedMesh &&
      skinnedMesh.skeleton &&
      !skeletons.has(skinnedMesh.skeleton)
    ) {
      skeletons.add(skinnedMesh.skeleton);
      skinnedMesh.skeleton.dispose?.();
    }

    const material = mesh.material;
    if (!material) {
      return;
    }

    if (Array.isArray(material)) {
      material.forEach((item) => disposeMaterial(
        item,
        materials,
        textures,
        imageSources,
      ));
      return;
    }

    disposeMaterial(material, materials, textures, imageSources);
  });
  object.clear();
}

function disposeMaterial(
  material: Material,
  materials: Set<Material>,
  textures: Set<Texture>,
  imageSources: Set<object>,
) {
  if (materials.has(material)) return;
  materials.add(material);
  Object.values(material).forEach((value) => {
    if (isTexture(value)) {
      disposeTexture(value, textures, imageSources);
    }
  });
  const uniforms = (material as Material & {
    uniforms?: Record<string, { value?: unknown }>;
  }).uniforms;
  for (const uniform of Object.values(uniforms ?? {})) {
    if (isTexture(uniform.value)) {
      disposeTexture(uniform.value, textures, imageSources);
    }
  }
  material.dispose();
}

function disposeTexture(
  texture: Texture,
  textures: Set<Texture>,
  imageSources: Set<object>,
) {
  if (textures.has(texture)) return;
  textures.add(texture);
  const image = texture.source?.data as unknown;
  if (image && typeof image === "object" && !imageSources.has(image)) {
    imageSources.add(image);
    const closable = image as { close?: () => void };
    closable.close?.();
  }
  texture.dispose();
}

function isTexture(value: unknown): value is Texture {
  return Boolean(value && typeof value === "object" && "isTexture" in value);
}
