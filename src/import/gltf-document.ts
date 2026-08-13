import { WebIO, type Document } from "@gltf-transform/core";
import { getGLTFPackageResources } from "./asset-package";

export async function readGLTFDocument(
  bytes: Uint8Array,
  sourceFile?: File,
  providedResources?: Record<string, Uint8Array<ArrayBuffer>>,
): Promise<Document> {
  const io = new WebIO();
  if (isTextGLTF(bytes)) {
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return io.readJSON({
      json,
      resources: providedResources ?? (sourceFile
        ? await getGLTFPackageResources(
            sourceFile,
            json as Record<string, unknown>,
          )
        : {}),
    });
  }
  return io.readBinary(bytes);
}

export async function collectTransferableGLTFResources(
  bytes: Uint8Array,
  sourceFile: File,
) {
  if (!isTextGLTF(bytes)) return undefined;
  const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<
    string,
    unknown
  >;
  const resources = await getGLTFPackageResources(sourceFile, json);
  return Object.fromEntries(
    Object.entries(resources).map(([uri, resource]) => [
      uri,
      resource.buffer.slice(
        resource.byteOffset,
        resource.byteOffset + resource.byteLength,
      ) as ArrayBuffer,
    ]),
  );
}

export function isTextGLTF(bytes: Uint8Array) {
  const first = new TextDecoder().decode(bytes.slice(0, 16)).trimStart();
  return first.startsWith("{");
}
