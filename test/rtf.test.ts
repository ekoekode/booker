import { describe, expect, it } from "vitest";
import { rtfToMarkdown } from "../src/import/rtf";

const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}{\colortbl;\red0\green0\blue0;}
\pard\fs56\b The Book\b0\par
\pard\fs36\b Chapter One\b0\par
\pard\fs24 It was a \i dark\i0  night, and she said \ldblquote hello\rdblquote  \u233?t\'e9.\par
{\*\generator Word;}\pard\fs24 Second \b bold\b0  paragraph.\par
{\footnote\fs24 hidden note}\pard\fs24 Third.\par
}`;

describe("rtf import", () => {
  it("makes larger short paragraphs headings and keeps emphasis, quotes and accents", () => {
    const md = rtfToMarkdown(rtf);
    expect(md).toContain("# The Book");
    expect(md).toContain("## Chapter One");
    expect(md).toContain("It was a *dark* night, and she said “hello” été.");
    expect(md).toContain("Second **bold** paragraph.");
    expect(md).not.toMatch(/Times|generator|hidden note/);
  });
  it("refuses a file that is not RTF", () => {
    expect(() => rtfToMarkdown("plain")).toThrow(/not an RTF/);
  });
});
