import { describe, expect, it } from "vitest";
import type { NlibEntry } from "../src/sources/nlib";
import { buildTree, entryForLoc, entryLabel, filterEntries } from "../src/sources/tree";

const e = (id: number, parent: number | null, title: string, locator = "", text = ""): NlibEntry => ({ id, parent, level: "x", locator, key: "", title, text });
const entries = [e(1, null, "Book I"), e(2, 1, "Chapter 1", "I.1", "In the beginning"), e(3, 1, "Chapter 2"), e(4, 99, "Orphan"), e(5, null, "Épître")];

describe("library tree", () => {
  it("nests entries under their parents and keeps orphans at the top", () => {
    const t = buildTree(entries);
    expect(t.roots.map((x) => x.id)).toEqual([1, 4, 5]);
    expect(t.kids.get(1)!.map((x) => x.id)).toEqual([2, 3]);
  });
  it("filters by every word, ignoring case and accents", () => {
    expect(filterEntries(entries, "epitre").map((x) => x.id)).toEqual([5]);
    expect(filterEntries(entries, "chapter 2").map((x) => x.id)).toEqual([3]);
    expect(filterEntries(entries, "", 2)).toHaveLength(2);
  });
  it("finds the entry a search hit came from", () => {
    expect(entryForLoc(entries, "I.1")?.id).toBe(2);
    expect(entryForLoc(entries, "I.1 (3)")?.id).toBe(2);
    expect(entryForLoc(entries, "Nowhere")).toBeUndefined();
    expect(entryLabel(e(9, null, "", "L"))).toBe("L");
  });
});
