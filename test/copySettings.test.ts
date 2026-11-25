import { describe, expect, it } from "vitest";
import { DEFAULT_COPY, flagsOf, formatVerses, parseCopy } from "../src/reader/copySettings";
import { nextLetterLabel } from "../src/notes/footnote";

const v = (verse: number, text = `t${verse}`, chapter = 3) => ({ chapter, verse, text });

describe("copy settings", () => {
  it("joins verses plainly by default, with … between gaps", () => {
    expect(formatVerses([v(16), v(17), v(20)], DEFAULT_COPY)).toBe("t16 t17 … t20");
    expect(formatVerses([v(16), v(20)], { ...DEFAULT_COPY, ellipsis: false })).toBe("t16 t20");
  });
  it("numbers verses, raised or plain, with or without the chapter", () => {
    const on = { ...DEFAULT_COPY, verseNumbers: true };
    expect(formatVerses([v(16), v(17)], on)).toBe("¹⁶t16 ¹⁷t17");
    expect(formatVerses([v(16)], { ...on, superscript: false })).toBe("16 t16");
    expect(formatVerses([v(16)], { ...on, chapterNumbers: true })).toBe("³·¹⁶t16");
    expect(formatVerses([v(16)], { ...on, superscript: false, chapterNumbers: true })).toBe("3:16 t16");
  });
  it("flags and parsing", () => {
    expect(flagsOf({ ...DEFAULT_COPY, letters: true, asQuote: false })).toEqual({ letters: true, inline: true });
    expect(parseCopy({ ellipsis: false, junk: 1 })).toEqual({ ...DEFAULT_COPY, ellipsis: false });
  });
  it("letter footnote labels", () => {
    expect(nextLetterLabel("x[^a] y[^b]")).toBe("c");
    expect(nextLetterLabel("none")).toBe("a");
  });
});
