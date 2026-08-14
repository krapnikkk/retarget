import { describe, expect, it } from "vitest";
import {
  RETARGET_ERROR_CODES,
  RETARGET_ERROR_MESSAGES,
  createRetargetError,
  isRetargetError,
} from "@/retarget";

describe("retarget error codes", () => {
  it("has a user-facing message for every public error code", () => {
    for (const code of RETARGET_ERROR_CODES) {
      expect(RETARGET_ERROR_MESSAGES[code]).toBeTruthy();
      expect(createRetargetError(code)).toMatchObject({
        code,
        message: RETARGET_ERROR_MESSAGES[code],
      });
      expect(createRetargetError(code)).toBeInstanceOf(Error);
    }
  });

  it("detects structured retarget errors from browser-only pipelines", () => {
    expect(isRetargetError(createRetargetError("FBX_PARSE_FAILED"))).toBe(true);
    expect(isRetargetError(new Error("FBX_PARSE_FAILED"))).toBe(false);
  });
});
