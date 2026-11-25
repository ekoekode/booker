import { describe, expect, it } from "vitest";
import { matchWord, nearlyEqual, stem } from "../src/sources/fuzzy";
import { buildIndex, search } from "../src/sources/index";
import { findRanges, highlightTerms, scopeTargets } from "../src/reader/searchOptions";
import { MemoryBible, type RawBible } from "../src/scripture/module";
import type { Source } from "../src/sources/types";

describe("fuzzy words", () => {
  it("brings other forms of a word together", () => {
    expect(stem("justification")).toBe(stem("justifications"));
    expect(matchWord("running", "runs")).toBe("stem");
    expect(matchWord("graces", "grace")).toBe("stem");
    expect(matchWord("gracelike", "grace")).toBe("prefix");
    expect(matchWord("gracr", "grace")).toBe("near");
    expect(matchWord("gxxce", "grace")).toBeNull(); // too short to guess
    expect(matchWord("predestinaton", "predestination")).toBe("near");
    expect(matchWord("faith", "hope")).toBeNull();
  });
  it("allows one slip: a letter changed, missing, added or swapped", () => {
    expect(nearlyEqual("repentance", "repentence")).toBe(true);
    expect(nearlyEqual("covenant", "covenat")).toBe(true);
    expect(nearlyEqual("covenant", "covenants")).toBe(true);
    expect(nearlyEqual("tihng", "thing")).toBe(true);
    expect(nearlyEqual("faith", "fate")).toBe(false);
  });
});

describe("searching an index in fuzzy mode", () => {
  const ix = buildIndex([{ loc: "1", text: "He was justified by faith." }, { loc: "2", text: "Justification is a gift." }, { loc: "3", text: "Nothing about it here." }]);
  it("exact mode finds only the word as typed", () => {
    expect(search(ix, "justify").length).toBe(0);
  });
  it("fuzzy mode finds the other forms of a word", () => {
    expect(search(ix, "justification", 10, "fuzzy").map((h) => h.chunk)).toEqual([1]);
    expect(search(ix, "justifying", 10, "fuzzy").map((h) => h.chunk)).toEqual([0]);
    expect(search(ix, "nothin", 10, "fuzzy").map((h) => h.chunk)).toEqual([2]); // the start of a word
  });
  it("still needs every word", () => {
    expect(search(ix, "justified gift", 10, "fuzzy")).toEqual([]);
    expect(search(ix, "justification gift", 10, "fuzzy").map((h) => h.chunk)).toEqual([1]);
  });
});

describe("searching a Bible in fuzzy mode", () => {
  const raw: RawBible = { name: "T", abbr: "T", verses: new Map([["JHN.3.16", "God so loved the world"], ["JHN.3.17", "The world is saved through him"], ["JHN.3.18", "He who believes is not condemned"]]), markup: "plain" } as any;
  const bible = new MemoryBible("t", raw);
  it("finds a verse by another form of the word", () => {
    expect(bible.search(["loves"], 10).length).toBe(0);
    expect(bible.search(["loves"], 10, "fuzzy").map((h) => h.v)).toEqual([16]);
    expect(bible.search(["believing"], 10, "fuzzy").map((h) => h.v)).toEqual([18]);
    expect(bible.search(["believes"], 10, "fuzzy").map((h) => h.v)).toEqual([18]);
  });
});

describe("colouring a page", () => {
  it("marks whole words that contain the term, or have a form of it", () => {
    const text = "Grace and graces, gracious grace.";
    expect(findRanges(text, ["grace"]).map(([a, b]) => text.slice(a, b))).toEqual(["Grace", "graces", "grace"]);
    expect(findRanges(text, ["grace"], "fuzzy").map(([a, b]) => text.slice(a, b))).toEqual(["Grace", "graces", "grace"]);
    expect(findRanges(text, [])).toEqual([]);
  });
  it("ignores accents and case, and takes the words of a phrase", () => {
    const t = "The Rêve of  FREE will";
    expect(findRanges(t, ["reve"]).map(([a, b]) => t.slice(a, b))).toEqual(["Rêve"]);
    expect(highlightTerms('free will "grace alone" -no')).toEqual(["grace alone", "free", "will"]);
  });
});

describe("what a scope searches", () => {
  const s = (uid: string, kind: Source["kind"], container?: string): Source => ({ uid, citekey: uid, title: uid, authors: [], type: "book", kind, file: `${uid}.x`, ...(container && { container }) });
  const all = [s("a", "db", "Fathers"), s("b", "db", "Fathers"), s("c", "db", "Lexicons"), s("d", "pdf")];
  it("a Bible: the current work is the Bible, the database is every Bible", () => {
    const here = { kind: "bible", module: "x", book: "JHN", chapter: 3, verse: 0 } as const;
    expect(scopeTargets("work", here, all)).toEqual({ bibles: "current", sources: [] });
    expect(scopeTargets("database", here, all)).toEqual({ bibles: "every", sources: [] });
    expect(scopeTargets("library", here, all).bibles).toBe("none");
    expect(scopeTargets("all", here, all)).toMatchObject({ bibles: "current", writing: true });
    expect(scopeTargets("writing", here, all)).toEqual({ bibles: "none", sources: [], writing: true });
  });
  it("a work: itself, or its whole database", () => {
    const here = { kind: "work", uid: "a", entry: 1 } as const;
    expect(scopeTargets("work", here, all).sources.map((x) => x.uid)).toEqual(["a"]);
    expect(scopeTargets("database", here, all).sources.map((x) => x.uid)).toEqual(["a", "b"]);
    expect(scopeTargets("docs", here, all).sources.map((x) => x.uid)).toEqual(["d"]);
    expect(scopeTargets("page", here, all)).toEqual({ bibles: "none", sources: [] });
  });
});

import { allVerses } from "../src/semantic/bibles";
describe("every verse of a module", () => {
  it("lists every verse as plain text, chapter by chapter", () => {
    const raw: RawBible = { name: "T", abbr: "T", verses: new Map([["JHN.3.17", "The  world is saved"], ["JHN.3.16", "God so loved"], ["GEN.1.1", "In the beginning"]]), markup: "plain" } as any;
    const mod = new MemoryBible("t", raw);
    const all = allVerses(mod);
    expect(all).toHaveLength(3);
    expect(all.filter((v) => v.c === 3).map((v) => [v.v, v.text])).toEqual([[16, "God so loved"], [17, "The world is saved"]]);
  });
});
