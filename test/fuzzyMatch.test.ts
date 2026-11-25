import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "../src/fuzzyMatch";

describe("fuzzyScore", () => {
  it("matches parts of words, near spellings and letters in order", () => {
    expect(fuzzyScore("beth", "Bethany Cole")).not.toBeNull();
    expect(fuzzyScore("bethnay", "Bethany Cole")).not.toBeNull();
    expect(fuzzyScore("bcl", "Bethany Cole")).not.toBeNull();
    expect(fuzzyScore("cole beth", "Bethany Cole")).not.toBeNull();
  });
  it("refuses what is not there", () => {
    expect(fuzzyScore("zed", "Bethany Cole")).toBeNull();
    expect(fuzzyScore("beth zed", "Bethany Cole")).toBeNull();
  });
  it("ranks whole words first", () => {
    expect(fuzzyFilter(["Bethany", "Beth"], "beth", (x) => x)).toEqual(["Beth", "Bethany"]);
  });
  it("ignores accents and case", () => {
    expect(fuzzyScore("jose", "José")).not.toBeNull();
  });
});
