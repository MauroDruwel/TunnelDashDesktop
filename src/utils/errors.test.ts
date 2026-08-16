import { describe, expect, it } from "vitest";
import { errMsg } from "./errors";

describe("errMsg", () => {
  it("returns plain strings (tauri command rejections)", () => {
    expect(errMsg("Invalid request headers", "Verification failed")).toBe("Invalid request headers");
  });

  it("returns Error messages", () => {
    expect(errMsg(new Error("No accounts returned"), "fallback")).toBe("No accounts returned");
  });

  it("falls back for unknown values", () => {
    expect(errMsg(undefined, "Verification failed")).toBe("Verification failed");
    expect(errMsg(null, "Verification failed")).toBe("Verification failed");
    expect(errMsg("", "Verification failed")).toBe("Verification failed");
  });
});
