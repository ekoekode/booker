import { describe, expect, it } from "vitest";
import { BOOKS, BOOK_BY_OSIS, findBook } from "../src/scripture/books";
import { formatPassage, parseRefs } from "../src/scripture/ref";

const p = (s: string) => parseRefs(s)!;
const fmt = (s: string) => p(s).map((x) => formatPassage(x, BOOK_BY_OSIS.get(x.book)!)).join("; ");

describe("books", () => {
  it("has 66 plus the Apocrypha, numbered in order", () => {
    expect(BOOKS.filter((b) => !b.extra)).toHaveLength(66);
    expect(BOOKS.find((b) => b.osis === "Rev")!.num).toBe(66);
    expect(BOOKS.find((b) => b.osis === "Tob")!.extra).toBe(true);
  });
  it("finds books from the many ways people write them", () => {
    const osis = (s: string) => findBook(s)?.osis;
    expect(osis("jn")).toBe("John");
    expect(osis("1 Cor.")).toBe("1Cor");
    expect(osis("I Corinthians")).toBe("1Cor");
    expect(osis("first john")).toBe("1John");
    expect(osis("Song of Songs")).toBe("Song");
    expect(osis("revel")).toBe("Rev");
    expect(osis("Ecclesiasticus")).toBe("Sir");
    expect(osis("deut")).toBe("Deut");
    expect(osis("ph")).toBeUndefined();
    expect(osis("Phil")).toBe("Phil");
    expect(osis("philem")).toBe("Phlm");
  });
});

describe("reference parser", () => {
  it("reads a verse, a range and a chapter", () => {
    expect(p("jn 3:16")[0]).toEqual({ book: "John", from: { c: 3, v: 16, part: undefined }, to: { c: 3, v: 16, part: undefined } });
    expect(fmt("John 3:16-18")).toBe("John 3:16–18");
    expect(fmt("Ps 23")).toBe("Psalms 23");
    expect(fmt("Psalm 119:105")).toBe("Psalms 119:105");
  });
  it("reads verse parts a, b and c", () => {
    const [r] = p("1 cor 13:4-7a");
    expect(r.book).toBe("1Cor");
    expect(r.to).toEqual({ c: 13, v: 7, part: "a" });
    expect(fmt("John 3:16b-17")).toBe("John 3:16b–17");
    expect(p("Rom 8:28b")[0].from.part).toBe("b");
  });
  it("reads lists, ranges across chapters and several books", () => {
    expect(p("Rom 8:28, 31")).toHaveLength(2);
    expect(p("Rom 8:28, 31")[1].from).toEqual({ c: 8, v: 31, part: undefined });
    expect(fmt("Gen 1:1-2:3")).toBe("Genesis 1:1–2:3");
    expect(fmt("Ps 119:105; Prov 3:5")).toBe("Psalms 119:105; Proverbs 3:5");
    expect(fmt("Isa 40-41")).toBe("Isaiah 40–41");
    expect(p("Jn 3:16; 5:24")[1]).toMatchObject({ book: "John", from: { c: 5, v: 24 } });
  });
  it("accepts spaces, dots and dashes of every kind", () => {
    expect(fmt("jn 3 16")).toBe("John 3:16");
    expect(fmt("jn3.16–17")).toBe("John 3:16–17");
    expect(fmt("1john 4:8")).toBe("1 John 4:8");
  });
  it("treats single-chapter books' numbers as verses", () => {
    expect(p("Jude 5")[0]).toMatchObject({ book: "Jude", from: { c: 1, v: 5 } });
    expect(p("Jude 1:5")[0].from).toMatchObject({ c: 1, v: 5 });
    expect(p("Obad 3-4")[0].to).toMatchObject({ c: 1, v: 4 });
  });
  it("reads the Apocrypha", () => {
    expect(p("Wis 3:1-4")[0].book).toBe("Wis");
    expect(p("Sirach 1:1")[0].book).toBe("Sir");
    expect(p("1 Macc 2:4")[0].book).toBe("1Macc");
  });
  it("refuses what is not a reference", () => {
    for (const bad of ["", "hello", "John", "John 3:16-2", "Rom 8:", "3:16", "xyzzy 3:16"]) {
      const r = parseRefs(bad);
      if (bad === "John") expect(r).toHaveLength(1);
      else expect(r).toBeNull();
    }
  });
});

import { referenceAt } from "../src/scripture/ref";
describe("referenceAt", () => {
  it("finds the reference around the cursor", () => {
    const line = "As we read in John 3:16 we see, and in 1 Cor 13:4-7a also.";
    expect(referenceAt(line, 20)).toEqual({ from: 14, to: 23 });
    expect(line.slice(referenceAt(line, 45)!.from, referenceAt(line, 45)!.to)).toBe("1 Cor 13:4-7a");
    expect(referenceAt(line, 2)).toBeNull();
  });
});
