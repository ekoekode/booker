import { describe, expect, it } from "vitest";
import { buildIndex, indexTerms } from "../src/export/bookIndex";

describe("book index", () => {
  it("reads terms from a list or a comma line, without repeats", () => {
    expect(indexTerms(["grace", " Grace ", "faith"])).toEqual(["grace", "faith"]);
    expect(indexTerms("grace, faith,, hope")).toEqual(["grace", "faith", "hope"]);
    expect(indexTerms(undefined)).toEqual([]);
  });
  it("lists whole-word matches by chapter, A to Z, and drops absent terms", () => {
    const idx = buildIndex(["faith", "Grace", "unseen"], [
      { where: "Chapter 1", text: "By grace we stand; graceful is not it." },
      { where: "Chapter 2", text: "Faith and Grace." },
      { where: "Chapter 2", text: "faith again" },
    ]);
    expect(idx).toEqual([
      { term: "faith", where: ["Chapter 2"] },
      { term: "Grace", where: ["Chapter 1", "Chapter 2"] },
    ]);
  });
});

import { mergeTerms, removeTerm, renameTerm, termNames } from "../src/export/bookIndex";

describe("index terms: spellings, rename, merge", () => {
  it("matches any spelling and prints the first", () => {
    const idx = buildIndex(["Jerusalem|Zion"], [
      { where: "Chapter 1", text: "Zion mourns." },
      { where: "Chapter 2", text: "Up to Jerusalem." },
    ]);
    expect(idx).toEqual([{ term: "Jerusalem", where: ["Chapter 1", "Chapter 2"] }]);
  });
  it("renames by changing the printed name and keeping the old one as a spelling", () => {
    expect(renameTerm(["grace", "faith"], "grace", "Grace")).toEqual(["Grace", "faith"]);
    expect(renameTerm(["Zion"], "Zion", "Jerusalem")).toEqual(["Jerusalem|Zion"]);
    expect(renameTerm(["a"], "a", "  ")).toEqual(["a"]);
  });
  it("merges one entry into another and removes it", () => {
    expect(mergeTerms(["Jerusalem", "Zion", "Salem"], "Zion", "Jerusalem")).toEqual(["Jerusalem|Zion", "Salem"]);
    expect(removeTerm(["a", "b"], "a")).toEqual(["b"]);
    expect(termNames("A| B |")).toEqual(["A", "B"]);
  });
});
