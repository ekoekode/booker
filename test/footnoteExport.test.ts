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
import { buildEpub } from "../src/export/epub";
import { buildPdf } from "../src/export/pdf";
import { Manuscript, parseMarkdown } from "../src/export/model";
import { ExportOptions } from "../src/export/headings";

const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  docx: true, epub: true, pdf: true, preset: "trade", minStatus: "draft", lineBreaksAreParagraphs: true, smartQuotes: false,
  sceneBreak: "* * *", chapterStyle: "number-title", actTitles: false, trimSize: "5.5x8.5", ...over,
});

const ms = (): Manuscript => {
  const p = (md: string) => parseMarkdown(md, { lineBreaksAreParagraphs: true, smartQuotes: false });
  return {
    title: "T", subtitle: "", author: "A", surname: "A", contact: "", language: "en", words: 5, dedication: "", copyright: "", about: "", coverPath: null, identifier: "urn:x",
    acts: [{ title: "Act", titled: false, number: 1, chapters: [
      { title: "One", number: 1, scenes: [{ title: "s", blocks: p("First claim.[^a] Second.^[inline note text]\n\n[^a]: Footnote about *Genesis*.") }] },
      { title: "Two", number: 2, scenes: [{ title: "s", blocks: p("Third.[^a]\n\n[^a]: Second chapter note.") }] },
    ] }],
  };
};

const part = async (buf: ArrayBuffer, name: string) => (await (await JSZip.loadAsync(buf)).file(name)!.async("string"));

describe("footnotes in Word", () => {
  it("writes real page-bottom footnotes", async () => {
    const buf = await buildDocx(ms(), opts({ notePlacement: "bottom" }), "*");
    const notes = await part(buf, "word/footnotes.xml");
    expect(notes).toContain("Footnote about");
    expect(notes).toContain("inline note text");
    expect(notes).toContain("Second chapter note.");
    expect(await part(buf, "word/document.xml")).toContain("w:footnoteReference");
  });
  it("lists notes at the end of each chapter, restarting the numbers", async () => {
    const doc = await part(await buildDocx(ms(), opts({ notePlacement: "chapter" }), "*"), "word/document.xml");
    expect(doc).toContain("Second chapter note.");
    expect(doc).not.toContain("w:footnoteReference");
    expect(doc.match(/>1\. </g)?.length).toBe(2);
  });
  it("lists notes at the end of the book", async () => {
    const doc = await part(await buildDocx(ms(), opts({ notePlacement: "book", noteNumbering: "book" }), "*"), "word/document.xml");
    expect(doc).toContain(">3. <");
  });
});

describe("footnotes in ePub", () => {
  it("links marks and notes both ways at the end of the chapter", async () => {
    const buf = await buildEpub(ms(), opts({ notePlacement: "bottom" }), "*", null);
    const ch = await part(buf, "OEBPS/text/ch001.xhtml");
    expect(ch).toContain('epub:type="noteref"');
    expect(ch).toContain('href="#fn-c1n1"');
    expect(ch).toContain('epub:type="footnote"');
    expect(ch).toContain('id="fn-c1n2"');
    expect(ch).toContain("#fnref-c1n1");
  });
  it("puts all notes in one file at the end of the book", async () => {
    const buf = await buildEpub(ms(), opts({ notePlacement: "book" }), "*", null);
    expect(await part(buf, "OEBPS/text/ch002.xhtml")).toContain('href="notes.xhtml#fn-c2n1"');
    const notes = await part(buf, "OEBPS/text/notes.xhtml");
    expect(notes).toContain("Second chapter note.");
    expect(notes).toContain("ch002.xhtml#fnref-c2n1");
    expect(await part(buf, "OEBPS/content.opf")).toContain('id="notes"');
  });
});

describe("footnotes in PDF", () => {
  it("still builds", async () => {
    for (const notePlacement of ["bottom", "chapter", "book"] as const) {
      const buf = await buildPdf(ms(), opts({ notePlacement }), "*");
      expect(buf.byteLength).toBeGreaterThan(1000);
    }
  });
});

import { PDFDocument } from "pdf-lib";

describe("footnotes at the foot of PDF pages", () => {
  const para = (n: number) => `Paragraph ${n} says that the harvest of that year was poor and the villagers gathered at the mill each evening.[^n${n}]`;
  const long = "A very long note that goes on and on about sources. ".repeat(40);
  const stress = (): Manuscript => {
    const p = (md: string) => parseMarkdown(md, { lineBreaksAreParagraphs: true, smartQuotes: false });
    const body = Array.from({ length: 40 }, (_, i) => para(i + 1)).join("\n\n");
    const notes = Array.from({ length: 40 }, (_, i) => `[^n${i + 1}]: ${i === 2 ? long : `Note ${i + 1}: see the parish record.`}`).join("\n");
    return { ...ms(), acts: [{ title: "Act", titled: false, number: 1, chapters: [{ title: "One", number: 1, scenes: [{ title: "s", blocks: p(`${body}\n\n${notes}`) }] }] }] };
  };
  it("finishes with very long notes and many notes per page, and does not drop pages", async () => {
    const bottom = await PDFDocument.load(await buildPdf(stress(), opts({ notePlacement: "bottom", noteNumbering: "chapter" }), "*"));
    const chapter = await PDFDocument.load(await buildPdf(stress(), opts({ notePlacement: "chapter", noteNumbering: "chapter" }), "*"));
    expect(bottom.getPageCount()).toBeGreaterThan(3);
    // notes at the foot take room from the text, so the book is not shorter than with notes listed after the chapter
    expect(bottom.getPageCount()).toBeGreaterThanOrEqual(chapter.getPageCount() - 1);
    expect(bottom.getPageCount()).toBeLessThan(chapter.getPageCount() * 2);
  });
});

import { sceneDateBlock } from "../src/export/gatherProject";
import { DEFAULT_SCENE_DATES } from "../src/export/headings";
describe("section dates", () => {
  it("prints nothing when off or when the section has no date", () => {
    expect(sceneDateBlock(undefined, "1891-03-12", undefined)).toBeNull();
    expect(sceneDateBlock({ ...DEFAULT_SCENE_DATES, on: false }, "1891-03-12", undefined)).toBeNull();
    expect(sceneDateBlock({ ...DEFAULT_SCENE_DATES, on: true }, "", undefined)).toBeNull();
  });
  it("keeps the text as typed, or spells a real date out, with the chosen look", () => {
    const o = { ...DEFAULT_SCENE_DATES, on: true, caps: true, size: 130, align: "center" as const };
    expect(sceneDateBlock(o, "Day 3", "dawn")).toMatchObject({ kind: "date", runs: [{ text: "DAY 3" }], style: { align: "center", size: 130, italic: true } });
    const long = sceneDateBlock({ ...DEFAULT_SCENE_DATES, on: true, format: "long", time: true }, "1891-03-12", "14:30") as any;
    expect(long.runs[0].text).toBe("March 12, 1891, 14:30");
  });
});
