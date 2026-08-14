import manifestJSON from "./non-humanoid-v1.json";

export const NON_HUMANOID_PIPELINE_CERTIFICATION = manifestJSON;

export function getNonHumanoidBetaPromotions() {
  return NON_HUMANOID_PIPELINE_CERTIFICATION.cases.flatMap((item) =>
    item.promotion?.assurance === "beta" ? [item.promotion] : [],
  );
}
