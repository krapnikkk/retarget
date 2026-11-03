import type { Document, WebIO } from "@gltf-transform/core";
import type { Object3D } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { AvatarFormatId } from "@/formats";
import {
  createAssetResourceScope,
  collectTransferableAssetPackage,
  getGLTFPackageResources,
} from "@/import/asset-package";
import { runRetargetJob } from "@/jobs/browser-retarget-job";
import { disposeObject } from "@/resources/dispose-three";
import { readFileArrayBufferWithSignal } from "@/browser/read-file";

export async function readAvatarAsGLBDocument({
  avatarFile,
  avatarFormatId,
  io,
  signal,
}: {
  avatarFile: File;
  avatarFormatId?: AvatarFormatId | null;
  io: WebIO;
  signal?: AbortSignal;
}): Promise<Document> {
  if (shouldReadAsGLB(avatarFile, avatarFormatId)) {
    return readGLTFDocument(
      io,
      new Uint8Array(await readFileArrayBufferWithSignal(
        avatarFile,
        "avatar",
        signal,
      )),
      avatarFile,
    );
  }

  if (avatarFormatId === "mmd-model" || /\.(pmx|pmd)$/i.test(avatarFile.name)) {
    const bytes = await runRetargetJob(
      {
        type: "convert-mmd-avatar",
        bytes: await readFileArrayBufferWithSignal(
          avatarFile,
          "avatar",
          signal,
        ),
        filename: avatarFile.name,
        assetPackage: await collectTransferableAssetPackage(avatarFile),
      },
      { bufferOwnership: "transfer", signal },
    );
    return io.readBinary(bytes);
  }

  const { resourceScope, root } = await parseFBXAvatarObject(
    avatarFile,
    avatarFormatId,
    signal,
  );
  try {
    const glbBytes = await exportObjectAsGLB(root);
    return io.readBinary(glbBytes);
  } finally {
    resourceScope.dispose();
    disposeObject(root);
  }
}

function shouldReadAsGLB(file: File, avatarFormatId?: AvatarFormatId | null) {
  if (avatarFormatId === "vrm") {
    return true;
  }

  return /\.(glb|gltf|vrm)$/i.test(file.name);
}

async function readGLTFDocument(io: WebIO, bytes: Uint8Array, file: File) {
  if (isTextGLTF(bytes)) {
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return io.readJSON({
      json,
      resources: await getGLTFPackageResources(
        file,
        json as Record<string, unknown>,
      ),
    });
  }

  return io.readBinary(bytes);
}

function isTextGLTF(bytes: Uint8Array) {
  const first = new TextDecoder().decode(bytes.slice(0, 16)).trimStart();
  return first.startsWith("{");
}

async function parseFBXAvatarObject(
  file: File,
  avatarFormatId?: AvatarFormatId | null,
  signal?: AbortSignal,
): Promise<{
  root: Object3D;
  resourceScope: ReturnType<typeof createAssetResourceScope>;
}> {
  const bytes = await readFileArrayBufferWithSignal(
    file,
    "avatar",
    signal,
  );
  if (
    avatarFormatId === "mixamo-rigged" ||
    avatarFormatId === "reallusion" ||
    avatarFormatId === "generic-fbx-avatar" ||
    /\.fbx$/i.test(file.name)
  ) {
    const resources = createAssetResourceScope(file);
    try {
      return {
        root: new FBXLoader(resources.manager).parse(bytes, ""),
        resourceScope: resources,
      };
    } catch (cause) {
      resources.dispose();
      throw cause;
    }
  }

  throw new Error(`Unsupported avatar conversion format: ${file.name}`);
}

function exportObjectAsGLB(root: Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
          return;
        }

        resolve(new TextEncoder().encode(JSON.stringify(result)));
      },
      reject,
      {
        binary: true,
        animations: [],
        includeCustomExtensions: true,
      },
    );
  });
}
