export const OPEN_ASSET_LICENSES = {
  "CC0-1.0": {
    attributionRequired: false,
    label: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  "CC-BY-4.0": {
    attributionRequired: true,
    label: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
} as const;

export type OpenAssetLicenseId = keyof typeof OPEN_ASSET_LICENSES;

export function getOpenAssetLicense(license: string) {
  if (!Object.hasOwn(OPEN_ASSET_LICENSES, license)) return null;
  const id = license as OpenAssetLicenseId;
  return { id, ...OPEN_ASSET_LICENSES[id] };
}
