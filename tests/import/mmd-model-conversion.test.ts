import { WebIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { convertMMDModelToGLB } from "@/io";
import { executeRetargetJob } from "@/jobs/execute-retarget-job";
import { RETARGET_JOB_PROTOCOL_VERSION } from "@/jobs/types";
import {
  createMinimalPMDAvatar,
  createMinimalPMXAvatar,
} from "../fixtures/mmd-models";

describe("convertMMDModelToGLB", () => {
  it("converts a PMX model to a self-contained skinned GLB", async () => {
    const glb = await convertMMDModelToGLB(
      createMinimalPMXAvatar("tex/base.png"),
      "avatar.pmx",
      {
        resolveResource: (uri) =>
          uri === "tex/base.png" ? new Uint8Array([1, 2, 3]) : null,
      },
    );
    const root = (await new WebIO().readBinary(glb)).getRoot();

    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listSkins()[0]?.listJoints().map((joint) => joint.getName()))
      .toEqual(["センター", "左腕"]);
    expect(
      root.listMeshes()[0]?.listPrimitives()[0]?.getAttribute("POSITION")?.getCount(),
    ).toBe(3);
    expect(root.listTextures().map((texture) => texture.getName()))
      .toEqual(["tex/base.png"]);
    expect(root.getExtras()).toMatchObject({
      mmdConversionCapabilityReport: { sourceFormat: "pmx", targetFormat: "glb" },
    });
  });

  it("detects PMX and PMD from content, not the filename", async () => {
    const pmd = await convertMMDModelToGLB(createMinimalPMDAvatar(), "renamed.pmx");
    const pmx = await convertMMDModelToGLB(createMinimalPMXAvatar(), "renamed.pmd");

    for (const [glb, sourceFormat] of [[pmd, "pmd"], [pmx, "pmx"]] as const) {
      const root = (await new WebIO().readBinary(glb)).getRoot();
      expect(root.getExtras()).toMatchObject({
        mmdConversionCapabilityReport: { sourceFormat },
      });
    }
  });

  it("rejects non-MMD bytes as an unsupported format", async () => {
    await expect(
      convertMMDModelToGLB(new TextEncoder().encode("glTF model"), "model.pmx"),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });

  it("applies caller budgets before allocating model arrays", async () => {
    const pmx = createMinimalPMXAvatar();
    for (const budget of [
      { maxInputBytes: pmx.byteLength - 1 },
      { maxVertices: 2 },
      { maxIndices: 2 },
      { maxBones: 1 },
      { maxStringBytes: 4 },
    ]) {
      await expect(convertMMDModelToGLB(pmx, "avatar.pmx", { budget }))
        .rejects.toMatchObject({ code: "PARSE_BUDGET_EXCEEDED" });
    }
    await expect(
      convertMMDModelToGLB(createMinimalPMDAvatar(), "avatar.pmd", {
        budget: { maxVertices: 2 },
      }),
    ).rejects.toMatchObject({ code: "PARSE_BUDGET_EXCEEDED" });
    await expect(
      convertMMDModelToGLB(pmx, "avatar.pmx", { budget: { maxBones: -1 } }),
    ).rejects.toMatchObject({ code: "PROCESSING_OPTION_INVALID" });
  });

  it("reports truncation and structural violations with stable codes", async () => {
    const pmx = createMinimalPMXAvatar();
    await expect(convertMMDModelToGLB(pmx.slice(0, 60)))
      .rejects.toMatchObject({ code: "PARSE_TRUNCATED" });

    const unsupportedVersion = pmx.slice();
    new DataView(unsupportedVersion.buffer).setFloat32(4, 3, true);
    await expect(convertMMDModelToGLB(unsupportedVersion))
      .rejects.toMatchObject({ code: "MMD_MODEL_PARSE_FAILED" });
  });

  it("applies the job parse budget and code across the Worker boundary", async () => {
    const run = (bytes: Uint8Array, parse?: { maxBones: number }) =>
      executeRetargetJob({
        schemaVersion: RETARGET_JOB_PROTOCOL_VERSION,
        jobId: "convert-mmd",
        budget: parse ? { parse } : undefined,
        task: {
          type: "convert-mmd-avatar",
          bytes: bytes.slice().buffer,
          filename: "avatar.pmx",
        },
      });
    const pmx = createMinimalPMXAvatar();
    await expect(run(pmx)).resolves.toBeInstanceOf(Uint8Array);
    await expect(run(pmx, { maxBones: 1 }))
      .rejects.toMatchObject({ code: "PARSE_BUDGET_EXCEEDED" });

    const unsupportedVersion = pmx.slice();
    new DataView(unsupportedVersion.buffer).setFloat32(4, 3, true);
    await expect(run(unsupportedVersion))
      .rejects.toMatchObject({ code: "MMD_MODEL_PARSE_FAILED" });
  });
});
