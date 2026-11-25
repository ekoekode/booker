import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

vi.mock("../src/export/fonts", () => {
  const f = (n: string) => new Uint8Array(readFileSync(`assets/fonts/Literata-${n}.ttf`));
  const data = { regular: f("Regular"), italic: f("Italic"), bold: f("Bold"), boldItalic: f("BoldItalic") };
  return {
    FONTS: data,
    FONT_FILES: [
      { name: "Literata-Regular.ttf", data: data.regular },
      { name: "Literata-Italic.ttf", data: data.italic },
      { name: "Literata-Bold.ttf", data: data.bold },
      { name: "Literata-BoldItalic.ttf", data: data.boldItalic },
    ],
  };
});

import { buildDocx } from "../src/export/docx";
import { buildEpub, blocksHtml } from "../src/export/epub";
import { buildPdf } from "../src/export/pdf";
import { Manuscript, parseMarkdown, parseInline } from "../src/export/model";
import { ExportOptions } from "../src/export/headings";
import { cleanXml, countWords, safeName, stripComments, stripLinks } from "../src/text";
import { applyInsertions, buildMatcher, findInsertions, linkDocument, protectedRanges, existingTargets, MAX_NAMES_PER_SERIES } from "../src/autolinkCore";

const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  docx: true, epub: true, pdf: true, preset: "trade", minStatus: "draft", lineBreaksAreParagraphs: true, smartQuotes: true,
  sceneBreak: "* * *", chapterStyle: "number-title", opening: { style: "off", frame: "none", lines: 3 }, actTitles: true, trimSize: "5.5x8.5", ...over,
});

const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const hostile = (s: string) => `${s}\u0000\u0001\u0008\u000B\u000C\u000E\u001F￾￿\uD800`;

function hostileManuscript(): Manuscript {
  const blocks = parseMarkdown(hostile("Hello *world*") + "\n\n" + hostile("Second"), { lineBreaksAreParagraphs: true, smartQuotes: false });
  return {
    title: hostile("Title"), subtitle: hostile("Sub"), author: hostile("Author"), surname: hostile("Sur"), contact: hostile("Contact"),
    language: hostile("en"), words: 3, dedication: hostile("Ded"), copyright: hostile("Copy"), about: hostile("About"),
    coverPath: null, identifier: hostile("urn:x"),
    acts: [{ title: hostile("Act"), titled: true, number: 1, chapters: [{ title: hostile("Chap"), number: 1, scenes: [{ title: hostile("Scene"), blocks: [...blocks, { kind: "p", runs: [{ text: hostile("raw run") }] }] }] }] }],
  };
}

async function allText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  let out = "";
  for (const name of Object.keys(zip.files)) {
    if (/\.(xml|xhtml|opf|ncx|rels)$/.test(name)) out += await zip.file(name)!.async("string");
  }
  return out;
}

describe("F1 XML-illegal characters", () => {
  it("cleanXml strips controls, noncharacters and lone surrogates but keeps real text", () => {
    expect(cleanXml(hostile("ok"))).toBe("ok");
    expect(cleanXml("tab\tnl\ncr\r 😀 é")).toBe("tab\tnl\ncr\r 😀 é");
  });
  it("parseMarkdown and parseInline never emit them", () => {
    const text = JSON.stringify(parseMarkdown(hostile("a **b**") + "\n# " + hostile("H"), { lineBreaksAreParagraphs: true, smartQuotes: true }));
    expect(text).not.toMatch(/\\u0000|\\u0001|\\u000b|\\ufffe/i);
    for (const r of parseInline(hostile("x"))) expect(r.text).not.toMatch(BAD);
  });
  it("epub output is clean", async () => {
    const all = await allText(await buildEpub(hostileManuscript(), opts(), hostile("*"), null));
    expect(all).not.toMatch(BAD);
    expect(all).not.toMatch(LONE);
    expect(all).toContain("Hello");
  });
  it("docx output is clean", async () => {
    const all = await allText(await buildDocx(hostileManuscript(), opts(), hostile("#")));
    expect(all).not.toMatch(BAD);
    expect(all).not.toMatch(LONE);
    expect(all).toContain("Hello");
  });
  it("pdf still builds with hostile strings", async () => {
    const data = await buildPdf(hostileManuscript(), opts(), hostile("#"));
    expect(data.byteLength).toBeGreaterThan(1000);
  });
});

const timed = (fn: () => unknown): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe("F2/F3/F7 regex DoS", () => {
  const N = 40000;
  const bases = ["[[", "![[", "<span ", "[a](", "[^", "<!--", "%%", "`", "[[a|", "http://", "$a"];
  for (const base of bases) {
    it(`handles ${N} x ${JSON.stringify(base)} quickly`, () => {
      const hostileText = base.repeat(N);
      expect(timed(() => stripLinks(hostileText))).toBeLessThan(300);
      expect(timed(() => stripComments(hostileText))).toBeLessThan(300);
      expect(timed(() => countWords(hostileText))).toBeLessThan(300);
      expect(timed(() => parseMarkdown(hostileText, { lineBreaksAreParagraphs: true, smartQuotes: true }))).toBeLessThan(300);
      const matcher = buildMatcher([{ name: "Aria", target: "Aria" }]);
      expect(timed(() => protectedRanges(hostileText))).toBeLessThan(300);
      expect(timed(() => existingTargets(hostileText))).toBeLessThan(300);
      expect(timed(() => findInsertions(hostileText, matcher, { mode: "every" }))).toBeLessThan(300);
      expect(timed(() => linkDocument(hostileText, matcher, { mode: "every" }))).toBeLessThan(300);
    });
  }
  it("also copes with a very long run of blank lines and rule-like text", () => {
    expect(timed(() => countWords("\n".repeat(N)))).toBeLessThan(300);
    expect(timed(() => countWords("- ".repeat(N) + "x"))).toBeLessThan(300);
  });

  it("normal links, embeds, comments and footnotes behave as before", () => {
    expect(stripLinks("a [[Aria|the hero]] b [[Mount Kess#Peak]] c ![[img.png]] d [site](http://x.y) e ![alt](p.png)")).toBe("a the hero b Mount Kess c  d site e ");
    expect(stripComments("a %%hidden\nmore%% b <!-- c --> d %%unclosed")).toBe("a  b  d %%unclosed");
    const md = (s: string) => parseMarkdown(s, { lineBreaksAreParagraphs: true, smartQuotes: false }).map((b) => (b.kind === "rule" ? "---" : b.runs.map((r) => r.text).join("")));
    expect(md("Text[^1] here.\n\n[^1]: A note.\n\n<span style=\"x\">kept</span> <br/>next")).toEqual(["Text here.", "kept", "next"]);
    expect(countWords("---\ntitle: x\n---\nOne [[Two|Three]] four %%no%%")).toBe(3);
  });
});

describe("F4 epub list merging", () => {
  it("keeps list grouping", () => {
    const html = blocksHtml(parseMarkdown("- a\n- b\n\ntext\n\n1. x\n2. y", { lineBreaksAreParagraphs: true, smartQuotes: false }), "*", false);
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<ol><li>x</li><li>y</li></ol>");
  });
  it("builds 30,000 list items in under 3 s", () => {
    const md = Array.from({ length: 30000 }, (_, i) => `- item ${i}`).join("\n");
    const blocks = parseMarkdown(md, { lineBreaksAreParagraphs: true, smartQuotes: false });
    expect(timed(() => blocksHtml(blocks, "*", false))).toBeLessThan(3000);
  });
});

describe("F5/F9 safeName", () => {
  it("returns empty for empty or reserved names", () => {
    for (const n of ["", "   ", "...", "///", "CON", "con", "Prn", "AUX", "nul", "COM1", "lpt9", "con.txt", "NUL.md", "COM5.anything"]) expect(safeName(n)).toBe("");
  });
  it("keeps ordinary names, including ones that merely contain a reserved word", () => {
    expect(safeName("Console")).toBe("Console");
    expect(safeName("COM10")).toBe("COM10");
    expect(safeName("My: Book?")).toBe("My Book");
    expect(safeName("The Auxiliary")).toBe("The Auxiliary");
  });
  it("caps length at 120", () => {
    expect(safeName("a".repeat(500)).length).toBe(120);
    expect(safeName("a".repeat(119) + " b").endsWith(" ")).toBe(false);
  });
});

describe("F6 auto-link alias abuse", () => {
  const link = (text: string, entries: Array<{ name: string; target: string; own?: boolean }>) => {
    const matcher = buildMatcher(entries);
    return applyInsertions(text, findInsertions(text, matcher, { mode: "every" }));
  };
  it("ignores aliases with link-breaking characters", () => {
    for (const bad of ["a]]b", "x|y", "x[y", "has#hash", "car^et", "line\nbreak", "tick`s", "evil]] [[Other"]) {
      const out = link(`before ${bad} after`, [{ name: bad, target: "Mara" }]);
      expect(out).toBe(`before ${bad} after`);
    }
  });
  it("cannot inject ]] through a target", () => {
    expect(link("Mara runs", [{ name: "Mara", target: "x]]y" }])).toBe("Mara runs");
    expect(link("Mara runs", [{ name: "Mara", target: "x|y" }])).toBe("Mara runs");
  });
  it("ignores short names and stop words, except 2-letter own names", () => {
    const text = "The and but he is Al and Bo went";
    expect(link(text, [{ name: "The", target: "A" }, { name: "and", target: "B" }, { name: "He", target: "C" }, { name: "Al", target: "D" }])).toBe(text);
    expect(link(text, [{ name: "Al", target: "Al", own: true }])).toBe("The and but he is [[Al]] and Bo went");
    expect(link("Ann and the", [{ name: "THE", target: "T" }, { name: "Ann", target: "Ann" }])).toBe("[[Ann]] and the");
  });
  it("caps names per series and reports the ignored count", () => {
    const entries = Array.from({ length: MAX_NAMES_PER_SERIES + 200 }, (_, i) => ({ name: `Name${i}`, target: `T${i}` }));
    entries.push({ name: "a", target: "x" }, { name: "the", target: "y" });
    const m = buildMatcher(entries)!;
    expect(m.byName.size).toBe(MAX_NAMES_PER_SERIES);
    expect(m.ignored).toBe(202);
  });
  it("still links normal names", () => {
    expect(link("Aria Vale met Mount Kess.", [{ name: "Aria Vale", target: "Aria Vale", own: true }, { name: "Mount Kess", target: "Mount Kess" }])).toBe("[[Aria Vale]] met [[Mount Kess]].");
  });
});

describe("case-insensitive matcher timing", () => {
  it("60 KB of text with 1500 names and the i flag finishes in under 2 s", () => {
    const entries = Array.from({ length: 1500 }, (_, i) => ({ name: `Nameless${i} of Place${i}`, target: `T${i}` }));
    entries.push({ name: "Mara Voss", target: "Mara Voss" });
    const m = buildMatcher(entries, { matchCase: "ignore" })!;
    const text = ("mara voss walked past nameless12 of place12 and MARA VOSS aaaaaaaa ".repeat(900)).slice(0, 61440);
    const t0 = performance.now();
    const ins = findInsertions(text, m, { mode: "every" });
    const dt = performance.now() - t0;
    console.log(`ci-matcher timing: ${dt.toFixed(0)} ms, ${ins.length} insertions`);
    expect(ins.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(2000);
  });
});
