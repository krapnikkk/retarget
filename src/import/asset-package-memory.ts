export type StoredAssetPackageContext<TReport = unknown> = {
  report: TReport;
  entries: Map<string, StoredAssetPackageEntry>;
  resources: Map<string, Blob>;
  uniqueBasenames: Map<string, Blob | null>;
};

export type StoredAssetPackageEntry = {
  name: string;
  blob: Blob;
};

const packageContexts = new WeakMap<
  File,
  StoredAssetPackageContext
>();

export function storeAssetPackageContext<TReport>(
  file: File,
  context: StoredAssetPackageContext<TReport>,
) {
  packageContexts.set(file, context as StoredAssetPackageContext);
}

export function getAssetPackageContext<TReport>(file: File) {
  return packageContexts.get(file) as
    | StoredAssetPackageContext<TReport>
    | undefined;
}

export function hasAssetPackageContext(file: File) {
  return packageContexts.has(file);
}

export function releaseAssetPackage(file: File | null | undefined) {
  if (!file) {
    return false;
  }
  const context = packageContexts.get(file);
  if (!context) {
    return false;
  }
  context.entries.clear();
  context.resources.clear();
  context.uniqueBasenames.clear();
  packageContexts.delete(file);
  return true;
}
