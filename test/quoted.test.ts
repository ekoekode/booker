import { describe, expect, it } from "vitest";
import { quotesOfNote, quotesOfText, quotesOfVerse, scanQuotes } from "../src/library/quoted";

const note = `Some text.

> For God so loved the world, that he gave his only begotten Son.[^1]

> Grace is the free favour of God toward sinners who deserve nothing at all.[^2]

[^1]: BLB, John 3:16.
[^2]: Augustine, in Church Fathers, on Romans 5:2.
`;

describe("quoted", () => {
  const all = scanQuotes("A.md", note);
  it("finds block quotes with their footnotes", () => {
    expect(all.length).toBe(2);
    expect(all[0].line).toBe(2);
  });
  it("matches a verse", () => {
    expect(quotesOfVerse(all, "John", 3, 16).length).toBe(1);
    expect(quotesOfVerse(all, "John", 3, 17).length).toBe(0);
  });
  it("matches a commentary note by name and verse", () => {
    expect(quotesOfNote(all, "Church Fathers", "Rom", 5, 2).length).toBe(1);
    expect(quotesOfNote(all, "Other", "Rom", 5, 2).length).toBe(0);
  });
  it("matches words of a work", () => {
    expect(quotesOfText(all, "Grace is the free favour of God toward sinners who deserve nothing at all. More text follows here.").length).toBe(1);
    expect(quotesOfText(all, "Short").length).toBe(0);
  });
});
