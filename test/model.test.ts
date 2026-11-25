import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText, roundedWords, smarten, slug } from "../src/export/model";

const opts = { lineBreaksAreParagraphs: true, smartQuotes: true };

describe("parseInline", () => {
  it("handles bold, italic and both", () => {
    expect(parseInline("a **b** *c* ***d***")).toEqual([
      { text: "a " },
      { text: "b", b: true },
      { text: " " },
      { text: "c", i: true },
      { text: " " },
      { text: "d", b: true, i: true },
    ]);
  });
  it("supports underscores but not snake_case", () => {
    expect(parseInline("_slow_ snake_case_name")).toEqual([{ text: "slow", i: true }, { text: " snake_case_name" }]);
  });
  it("leaves unmatched markers as text", () => {
    expect(plainText(parseInline("5 * 3 and **oops"))).toBe("5 * 3 and **oops");
  });
  it("handles strikethrough, highlights and code", () => {
    expect(plainText(parseInline("~~gone~~ ==hi== `x`"))).toBe("gone hi x");
    expect(parseInline("~~gone~~")[0].s).toBe(true);
  });
  it("honours escapes", () => {
    expect(plainText(parseInline("\\*not italic\\*"))).toBe("*not italic*");
  });
});

describe("smarten", () => {
  it("curls double quotes", () => {
    expect(smarten('"Hello," she said. "Go."')).toBe("“Hello,” she said. “Go.”");
  });
  it("curls apostrophes and single quotes", () => {
    expect(smarten("don't 'quote' it")).toBe("don’t ‘quote’ it");
    expect(smarten("'Tis the '90s")).toBe("’Tis the ’90s");
  });
  it("converts dashes and ellipses", () => {
    expect(smarten("wait--no... really---yes")).toBe("wait—no… really—yes");
  });
  it("treats a quote after emphasis marker as opening", () => {
    expect(smarten('*"Yes,"* he said')).toBe("*“Yes,”* he said");
  });
});

describe("parseMarkdown", () => {
  it("makes each line a paragraph by default, and joins lines when told", () => {
    const md = "One.\nTwo.\n\nThree.";
    expect(parseMarkdown(md, opts).map((b) => (b as any).runs[0].text)).toEqual(["One.", "Two.", "Three."]);
    expect(parseMarkdown(md, { ...opts, lineBreaksAreParagraphs: false }).map((b) => (b as any).runs[0].text)).toEqual(["One. Two.", "Three."]);
  });
  it("turns rules into scene breaks and keeps headings and quotes", () => {
    const b = parseMarkdown("# Title\n\n> quoted\n> more\n\n* * *\n\nText", opts);
    expect(b.map((x) => x.kind)).toEqual(["h", "quote", "rule", "p"]);
    expect(plainText((b[1] as any).runs)).toBe("quoted more");
  });
  it("strips comments, links, frontmatter-free input and footnotes", () => {
    const b = parseMarkdown("She met [[Aria Vale|Aria]]%% note %%.[^1]\n\n[^1]: gone", opts);
    expect(b).toHaveLength(1);
    expect(plainText((b[0] as any).runs)).toBe("She met Aria.");
  });
  it("does not mistake bold at line start for a list", () => {
    expect(parseMarkdown("**Bold** start", opts)[0].kind).toBe("p");
    expect(parseMarkdown("- item", opts)[0].kind).toBe("li");
  });
});

describe("helpers", () => {
  it("rounds word counts", () => {
    expect(roundedWords(83412)).toBe(83500);
    expect(roundedWords(120400)).toBe(120000);
    expect(roundedWords(450)).toBe(500);
  });
  it("slugs", () => {
    expect(slug("Café Noir: Vol. 2")).toBe("cafe-noir-vol-2");
    expect(slug("***")).toBe("book");
  });
});
