import { describe, expect, it } from "vitest";
import { firstReadable, isFlat, levelChoices } from "../src/sources/levels";
import type { NlibEntry } from "../src/sources/nlib";
import { buildTree } from "../src/sources/tree";

const e = (id: number, parent: number | null, level: string, title: string, text = ""): NlibEntry => ({ id, parent, level, locator: "", key: "", title, text });

describe("levelChoices", () => {
  const list = [
    e(1, null, "work", "Antiquities"),
    e(2, 1, "book", "Book 1"),
    e(3, 2, "chapter", "Ch 1"),
    e(4, 3, "section", "§1", "text a"),
    e(5, 3, "section", "§2", "text b"),
    e(6, 2, "chapter", "Ch 2"),
    e(7, 6, "section", "§1", "text c"),
    e(8, 1, "book", "Book 2"),
    e(9, 8, "chapter", "Ch 1"),
    e(10, 9, "section", "§1", "text d"),
  ];
  const tree = buildTree(list);
  it("finds the first readable entry under a heading", () => {
    expect(firstReadable(tree, list[1])?.id).toBe(4);
    expect(firstReadable(tree, list[7])?.id).toBe(10);
  });
  it("gives a drop-down per level with more than one choice", () => {
    const lv = levelChoices(list, tree, list[4]);
    expect(lv.map((l) => l.label)).toEqual(["Book", "Chapter", "Section"]);
    expect(lv[0].options.map((o) => o.text)).toEqual(["Book 1", "Book 2"]);
    expect(lv[0].selected).toBe(4);
    expect(lv[2].selected).toBe(5);
  });
  it("skips levels with one choice", () => {
    const lv = levelChoices(list, tree, list[9]);
    expect(lv.map((l) => l.label)).toEqual(["Book"]);
  });
});

describe("flat dictionaries", () => {
  const words = Array.from({ length: 60 }, (_, i) => e(i + 1, null, "entry", `${String.fromCharCode(65 + (i % 3))}word${i}`, "def"));
  const tree = buildTree(words);
  it("offers Letter and Entry", () => {
    expect(isFlat(tree, words)).toBe(true);
    const lv = levelChoices(words, tree, words[1]);
    expect(lv.map((l) => l.label)).toEqual(["Letter", "Entry"]);
    expect(lv[0].options.map((o) => o.text)).toEqual(["A", "B", "C"]);
    expect(lv[1].options.length).toBe(20);
    expect(lv[1].selected).toBe(2);
  });
});
