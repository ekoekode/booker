import { describe, expect, it } from "vitest";
import { allSpans, findSpans, protectChanges, type Chg } from "../src/writing/hideMarks";

const apply = (doc: string, cs: Chg[]) => cs.slice().sort((a, b) => b.from - a.from).reduce((d, c) => d.slice(0, c.from) + c.insert + d.slice(c.to), doc);
const del = (doc: string, from: number, to: number, dir: "back" | "forward" | null = null) => apply(doc, protectChanges(doc, [{ from, to, insert: "" }], dir));

describe("findSpans", () => {
  it("finds bold, italic, strike and highlight", () => {
    expect(findSpans("a **b** c").map((s) => s.inner)).toEqual([[4, 5]]);
    expect(findSpans("*a* ~~b~~ ==c==").length).toBe(3);
  });
  it("ignores lone marks, lists, code and escapes", () => {
    expect(findSpans("* item")).toEqual([]);
    expect(findSpans("2 * 3 * 4")).toEqual([]);
    expect(findSpans("`**x**`")).toEqual([]);
    expect(findSpans("\\*a\\*")).toEqual([]);
    expect(findSpans("snake_case_name")).toEqual([]);
    expect(findSpans("** **")).toEqual([]);
  });
  it("handles bold italic", () => {
    expect(findSpans("***x***").length).toBe(2);
  });
  it("skips properties and code fences", () => {
    expect(allSpans("---\ntitle: **x**\n---\n**a**\n```\n**b**\n```\n").length).toBe(1);
  });
});

describe("protectChanges", () => {
  it("keeps the marks while words remain", () => {
    expect(del("a **bold** b", 4, 6)).toBe("a **ld** b");
  });
  it("keeps the marks when a selection runs across them", () => {
    expect(del("a **bold** b", 1, 7)).toBe("a**d** b");
    expect(del("a **bold** b", 1, 11)).toBe("ab");
  });
  it("takes the marks away when the words are all gone", () => {
    expect(del("a **bold** b", 4, 8)).toBe("a  b");
  });
  it("takes the marks away when only spaces are left", () => {
    expect(del("a **x y** b", 5, 7)).toBe("a **x** b");
    expect(del("a **x y** b", 4, 7)).toBe("a  b");
  });
  it("backspace beside a closing mark deletes the nearest letter", () => {
    expect(del("**bold**is", 6, 8, "back")).toBe("**bol**is");
  });
  it("delete beside an opening mark takes the next letter", () => {
    expect(del("a **bold** b", 2, 4, "forward")).toBe("a **old** b");
  });
  it("the last letter takes the marks with it", () => {
    expect(del("a **b** c", 5, 7, "back")).toBe("a  c");
  });
  it("leaves edits outside any pair alone", () => {
    expect(del("plain text", 0, 5)).toBe(" text");
  });
});

import { headingMarks } from "../src/writing/hideMarks";
describe("headingMarks", () => {
  it("finds the # marks of headings with words, not code or empty headings", () => {
    const doc = "# One\ntext\n## Two\n##\n```\n# not\n```\n####### seven";
    expect(headingMarks(doc)).toEqual([[0, 2], [11, 14]]);
  });
});
