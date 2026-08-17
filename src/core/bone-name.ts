export function normalizeBoneName(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const ascii = normalized
    .replace(/^mixamorig[:_]?/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  return ascii || normalized.replace(/\s+/g, "").toLowerCase();
}
