import { describe, it, expect } from "vitest";
import { gapYears, resolveStarts, LIFE_TEMPLATE, type SeqItem } from "../src/project/sequence";
import { checkSequences } from "../src/project/sequenceCheck";

const I = (path: string, seq: number, when: string, whenEnd = "", extra: Partial<SeqItem> = {}): SeqItem => ({ path, group: "Ann", seq, when, whenEnd, ...extra });
const tpl = () => LIFE_TEMPLATE;
const none = new Map();

describe("gap parsing", () => {
  it("reads units", () => {
    expect(gapYears("3d")).toBeCloseTo(3 / 365.25);
    expect(gapYears("2w")).toBeCloseTo(14 / 365.25);
    expect(gapYears("1y")).toBeCloseTo(1);
    expect(gapYears("")).toBeNull();
    expect(gapYears("soon")).toBeNull();
  });
});

describe("resolveStarts", () => {
  it("chains sequential items with the default gap", () => {
    const r = resolveStarts([I("a", 1, "1342-05-01", "1342-05-10"), I("b", 2, "1342-01-01", "1342-01-05"), I("c", 3, "1300-01-01")], none, tpl);
    const b = r.edits.find((e) => e.path === "b")!;
    expect(b.when).toBe("1342-05-13");
    expect(b.whenEnd).toBe("1342-05-17");
    expect(r.edits.find((e) => e.path === "c")?.when).toBe("1342-05-20");
  });
  it("is idempotent", () => {
    const r1 = resolveStarts([I("a", 1, "1342-05-01", "1342-05-10"), I("b", 2, "1342-05-13", "1342-05-17")], none, tpl);
    expect(r1.edits).toEqual([]);
  });
  it("honours a per-item gap and anchor to an external note", () => {
    const ext = new Map([["scene", { when: "1400-06-01", whenEnd: "1400-06-02" }]]);
    const r = resolveStarts([I("x", 0, "", "", { anchor: "scene", gap: "1w" })], ext, tpl);
    expect(r.edits[0].when).toBe("1400-06-09");
  });
  it("anchors 'with' a start edge", () => {
    const ext = new Map([["p", { when: "1400-06-01", whenEnd: "" }]]);
    const r = resolveStarts([I("x", 0, "", "", { anchor: "p", anchorEdge: "start", anchorMode: "with" })], ext, tpl);
    expect(r.edits[0].when).toBe("1400-06-01");
  });
  it("an explicit anchor that is a single day counts as both its start and end", () => {
    const ext = new Map([["ev", { when: "1500-03-01", whenEnd: "" }]]);
    const r = resolveStarts([I("x", 0, "", "", { anchor: "ev", anchorMode: "after", anchorEdge: "end", gap: "5d" })], ext, tpl);
    expect(r.edits[0].when).toBe("1500-03-06");
  });
  it("leaves free items alone", () => {
    expect(resolveStarts([I("f", 0, "1200")], none, tpl).edits).toEqual([]);
  });
  it("does not resolve from an open-ended predecessor", () => {
    const r = resolveStarts([I("a", 1, "1342-05-01"), I("b", 2, "1342-09-01")], none, tpl);
    expect(r.edits).toEqual([]);
    expect(r.unresolved).toEqual(["b"]);
  });
  it("reports cycles without editing", () => {
    const r = resolveStarts([I("a", 0, "1342-05-01", "1342-05-02", { anchor: "b" }), I("b", 0, "1342-06-01", "1342-06-02", { anchor: "a" })], none, tpl);
    expect(r.cyclic.sort()).toEqual(["a", "b"]);
    expect(r.edits).toEqual([]);
  });
});

describe("checkSequences", () => {
  const codes = (items: SeqItem[], exists = () => true) => checkSequences(items, none, tpl, exists).map((f) => f.code);
  it("is quiet for a healthy sequence", () => {
    expect(codes([I("a", 1, "1342-05-01", "1342-05-10"), I("b", 2, "1342-05-13", "1342-05-17")])).toEqual([]);
  });
  it("flags drift, gaps and duplicates", () => {
    expect(codes([I("a", 1, "1342-05-01", "1342-05-10"), I("b", 2, "1342-05-20", "1342-05-21")])).toContain("drift");
    expect(codes([I("a", 1, "1342-05-01", "1342-05-10"), I("b", 3, "1342-05-13", "1342-05-17")])).toContain("number-gap");
    expect(codes([I("a", 1, "1342-05-01", "1342-05-10"), I("b", 1, "1342-05-13", "1342-05-17")])).toContain("number-dup");
  });
  it("flags dangling anchors, bad gaps and cycles", () => {
    expect(codes([I("a", 0, "1342-05-01", "", { anchor: "gone" })], () => false)).toContain("dangling-anchor");
    expect(codes([I("a", 0, "1342-05-01", "", { gap: "??" })])).toContain("bad-gap");
    expect(codes([I("a", 0, "1342", "", { anchor: "b" }), I("b", 0, "1343", "", { anchor: "a" })])).toContain("cycle");
  });
});

import { buildItem } from "../src/project/sequence";
describe("buildItem", () => {
  const era = { ...LIFE_TEMPLATE, id: "era", type: "era", folder: "Eras", defaultGap: "1w" };
  it("numbers after the group's last and starts one gap after it ends", () => {
    const r = buildItem(era, "Ann", [I("a", 1, "1342-05-01", "1342-05-10", { group: "era/Ann" })], "Ann 2", true, "2026-01-01");
    expect(r.number).toBe(2);
    expect(r.storyDate).toBe("1342-05-17");
    expect(r.fm).toMatchObject({ type: "era", template: "era", sequence: "era/Ann", number: 2, character: "[[Ann]]" });
  });
  it("leaves a free item unnumbered and undated", () => {
    const r = buildItem(era, "Ann", [I("a", 1, "1342-05-01", "1342-05-10", { group: "era/Ann" })], "x", false, "2026-01-01");
    expect(r).toMatchObject({ number: 0, storyDate: "" });
    expect(r.fm.number).toBe("");
  });
  it("starts the first item with no date and ignores other groups", () => {
    const r = buildItem(era, "Bob", [I("a", 1, "1342-05-01", "1342-05-10", { group: "era/Ann" })], "Bob 1", true, "2026-01-01");
    expect(r).toMatchObject({ number: 1, storyDate: "" });
  });
  it("does not number or date from another template's items for the same person", () => {
    const r = buildItem(era, "Ann", [I("life1", 1, "1342-05-01", "1342-05-10", { group: "life/Ann" }), I("life2", 2, "1342-05-13", "1342-05-17", { group: "life/Ann" })], "Era 1", true, "2026-01-01");
    expect(r).toMatchObject({ number: 1, storyDate: "" });
  });
  it("records its own gap and anchor, and starts where the anchor says", () => {
    const r = buildItem(era, "Ann", [], "Era", true, "2026-01-01", { gap: "2w", anchor: "Scene 12", anchorMode: "after", anchorEdge: "end", anchorDate: { when: "1400-06-01", whenEnd: "1400-06-02" } });
    expect(r.storyDate).toBe("1400-06-16");
    expect(r.fm).toMatchObject({ anchor: "[[Scene 12]]", anchorMode: "after", anchorEdge: "end", gap: "2w" });
  });
  it("leaves the anchor fields out when none is given", () => {
    const r = buildItem(era, "Ann", [], "Era", true, "2026-01-01");
    expect(r.fm.anchor).toBeUndefined();
    expect(r.fm.gap).toBeUndefined();
  });
});
