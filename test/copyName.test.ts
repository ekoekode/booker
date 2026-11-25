import { describe, expect, it } from "vitest";
import { freeCopyName } from "../src/project/vaultOps";

describe("freeCopyName", () => {
  it("uses (copy) first, then numbers", () => {
    expect(freeCopyName(() => false, "Novel")).toBe("Novel (copy)");
    const taken = new Set(["Novel (copy)", "Novel (copy 2)"]);
    expect(freeCopyName((p) => taken.has(p), "Novel")).toBe("Novel (copy 3)");
  });
});
