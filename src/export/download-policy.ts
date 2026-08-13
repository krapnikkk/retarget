export type SemanticDownloadEvidence =
  | { status: "passed" }
  | { status: "failed"; issues: string[] }
  | { status: "unavailable"; issues?: string[] };

export type ExportDownloadDecision =
  | { status: "allowed"; experimental: false }
  | { status: "allowed"; experimental: true }
  | { status: "confirmation-required"; issues: string[] }
  | { status: "blocked"; issues: string[] };

export function evaluateExportDownload({
  consentToExperimental,
  lockedSemanticEvidence,
  semantic,
  structuralPassed,
}: {
  consentToExperimental: boolean;
  lockedSemanticEvidence: boolean;
  semantic: SemanticDownloadEvidence;
  structuralPassed: boolean;
}): ExportDownloadDecision {
  if (!structuralPassed) {
    return { status: "blocked", issues: ["Structural validation failed."] };
  }
  if (semantic.status === "passed") {
    return { status: "allowed", experimental: false };
  }
  const issues =
    semantic.issues && semantic.issues.length > 0
      ? semantic.issues
      : ["Semantic validation is unavailable for this output path."];
  if (lockedSemanticEvidence && semantic.status === "failed") {
    return { status: "blocked", issues };
  }
  if (!consentToExperimental) {
    return { status: "confirmation-required", issues };
  }
  return { status: "allowed", experimental: true };
}
