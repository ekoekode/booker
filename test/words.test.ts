import { describe, expect, it } from "vitest";
import { levelsFromSlots } from "../src/profiles/structure";
import { wordsFor } from "../src/profiles/words";

const names: [string, string, string] = ["", "", ""];

describe("wordsFor", () => {
  it("names three levels", () => {
    const w = wordsFor({ levels: levelsFromSlots(3, names) });
    expect([w.hasTop, w.hasMid, w.top, w.mid, w.item]).toEqual([true, true, "Act", "Chapter", "Scene"]);
    expect(w.items(2)).toBe("2 scenes");
  });
  it("two levels have no middle", () => {
    const w = wordsFor({ levels: levelsFromSlots(2, ["Series", "", "Sermon"]) });
    expect([w.hasTop, w.hasMid, w.top, w.item, w.itemMany]).toEqual([true, false, "Series", "Sermon", "Sermons"]);
    expect(w.items(1)).toBe("1 sermon");
  });
  it("one level has only items", () => {
    const w = wordsFor({ levels: levelsFromSlots(1, ["", "", "Entry"]) });
    expect([w.hasTop, w.hasMid, w.item, w.itemMany]).toEqual([false, false, "Entry", "Entries"]);
  });
});

import { actHeading, chapterHeading } from "../src/export/headings";

describe("export headings use the book's words", () => {
  it("prints items as the chapters with their own word", () => {
    expect(chapterHeading({ title: "Grace", word: "Sermon", number: 2, scenes: [] }, "number-title")).toEqual({ label: "Sermon 2", title: "Grace" });
    expect(chapterHeading({ title: "Sermon 2", word: "Sermon", number: 2, scenes: [] }, "number-title")).toEqual({ label: "Sermon 2", title: "" });
    expect(chapterHeading({ title: "Intro", number: 1, scenes: [] }, "number-title")).toEqual({ label: "Chapter 1", title: "Intro" });
  });
  it("names the top level", () => {
    expect(actHeading({ title: "Faith", titled: true, word: "Series", number: 1, chapters: [] })).toBe("Series One: Faith");
    expect(actHeading({ title: "Faith", titled: true, number: 1, chapters: [] })).toBe("Part One: Faith");
  });
});
