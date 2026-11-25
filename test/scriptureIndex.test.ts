import { describe, expect, it } from "vitest";
import { buildScriptureIndex, scanReferences } from "../src/scripture/index";

describe("scanning prose for references", () => {
  it("finds references inside sentences", () => {
    const r = scanReferences("As John 3:16 says, and see also 1 Cor 13:4-7a; Romans 8:28, 31 too.");
    expect(r.map((p) => `${p.book} ${p.from.c}:${p.from.v}`)).toEqual(["John 3:16", "1Cor 13:4", "Rom 8:28", "Rom 8:31"]);
  });
  it("finds a reference after several lead-in words", () => {
    expect(scanReferences("(John 3:16). See also Romans 8:28 and 1 Cor 13:4-7.").map((p) => p.book)).toEqual(["John", "Rom", "1Cor"]);
  });
  it("ignores ordinary words followed by numbers", () => {
    expect(scanReferences("In chapter 3 there were 12 men and Tuesday 5 more.")).toEqual([]);
  });
});

describe("scripture index", () => {
  it("groups by book in canon order and lists each place once", () => {
    const f = (t: string, where: string) => scanReferences(t).map((passage) => ({ passage, where }));
    const idx = buildScriptureIndex([...f("Romans 8:28 and John 3:16", "Chapter 2"), ...f("John 3:16 again, Genesis 1:1", "Chapter 3"), ...f("John 3:16", "Chapter 3")]);
    expect(idx.map((g) => g.book)).toEqual(["Genesis", "John", "Romans"]);
    expect(idx[1].entries).toEqual([{ label: "John 3:16", where: ["Chapter 2", "Chapter 3"] }]);
  });
});

describe("one-chapter books", () => {
  it("are written by verse alone", () => {
    const idx = buildScriptureIndex(scanReferences("Jude 5 and Jude 3-4").map((passage) => ({ passage, where: "Chapter 1" })));
    expect(idx[0].entries.map((e) => e.label)).toEqual(["Jude 3–4", "Jude 5"]);
  });
});

import { locateReferences } from "../src/scripture/index";
describe("locating references", () => {
  it("gives the exact stretch of text of each reference", () => {
    const t = "As (John 3:16). See also Romans 8:28, 31 and 1 Cor 13:4-7.";
    expect(locateReferences(t).map((l) => l.text)).toEqual(["John 3:16", "Romans 8:28, 31", "1 Cor 13:4-7"]);
    const l = locateReferences(t)[1];
    expect(t.slice(l.from, l.to)).toBe(l.text);
  });
});
