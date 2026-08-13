import { describe, expect, it } from "vitest";
import { evaluateExportDownload } from "@/export/download-policy";

describe("export download policy", () => {
  it("never permits structurally invalid output", () => {
    expect(
      evaluateExportDownload({
        consentToExperimental: true,
        lockedSemanticEvidence: false,
        semantic: { status: "passed" },
        structuralPassed: false,
      }),
    ).toMatchObject({ status: "blocked" });
  });

  it("allows semantic-passed output without an experimental prompt", () => {
    expect(
      evaluateExportDownload({
        consentToExperimental: false,
        lockedSemanticEvidence: false,
        semantic: { status: "passed" },
        structuralPassed: true,
      }),
    ).toEqual({ status: "allowed", experimental: false });
  });

  it("requires explicit consent when semantic evidence fails or is unavailable", () => {
    const input = {
      consentToExperimental: false,
      lockedSemanticEvidence: false,
      structuralPassed: true,
    } as const;
    expect(
      evaluateExportDownload({
        ...input,
        semantic: { status: "failed", issues: ["world-space drift"] },
      }),
    ).toEqual({
      status: "confirmation-required",
      issues: ["world-space drift"],
    });
    expect(
      evaluateExportDownload({
        ...input,
        semantic: { status: "unavailable" },
      }),
    ).toMatchObject({ status: "confirmation-required" });
  });

  it("hard-blocks a runtime failure for a pipeline with locked semantic evidence", () => {
    expect(
      evaluateExportDownload({
        consentToExperimental: true,
        lockedSemanticEvidence: true,
        semantic: { status: "failed", issues: ["Golden Motion mismatch"] },
        structuralPassed: true,
      }),
    ).toEqual({
      status: "blocked",
      issues: ["Golden Motion mismatch"],
    });
  });
});
