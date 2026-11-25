import { describe, expect, it } from "vitest";
import { interpret, opensByItself } from "../src/scripture/omnibox";

const have = ["Gen", "Ps", "Matt", "John", "Rom", "1Cor", "2Cor", "Rev"];

describe("interpret", () => {
  it("is empty for blank input", () => {
    expect(interpret("  ", have).kind).toBe("empty");
  });
  it("reads a verse", () => {
    const t = interpret("john 3:16", have);
    expect(t).toMatchObject({ kind: "ref", book: "John", chapter: 3, verse: 16 });
    expect(opensByItself(t, "john 3:16")).toBe(true);
  });
  it("reads a chapter and a range", () => {
    expect(interpret("Ps 23", have)).toMatchObject({ kind: "ref", book: "Ps", chapter: 23, verse: 0 });
    const r = interpret("Gen 1:1-3", have);
    expect(r).toMatchObject({ kind: "ref", book: "Gen", chapter: 1, verse: 1 });
    if (r.kind === "ref") expect(r.passage.to.v).toBe(3);
  });
  it("opens a bare book at chapter 1 but not by itself", () => {
    const t = interpret("Romans", have);
    expect(t).toMatchObject({ kind: "ref", book: "Rom", chapter: 1 });
    expect(opensByItself(t, "Romans")).toBe(false);
  });
  it("offers books for a prefix, only those the Bible has", () => {
    const t = interpret("co", have);
    expect(t.kind).toBe("books");
    if (t.kind === "books") expect(t.books).toEqual(["1Cor", "2Cor"]);
  });
  it("searches words otherwise", () => {
    expect(interpret("love your enemies", have)).toEqual({ kind: "search", words: ["love", "your", "enemies"] });
  });
  it("does not offer a book the Bible lacks", () => {
    expect(interpret("jud", have).kind).toBe("search");
  });
});
