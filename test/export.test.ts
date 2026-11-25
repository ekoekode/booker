import { describe, expect, it, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

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
import { breakMark } from "../src/export/headings";
import { buildEpub } from "../src/export/epub";
import { buildPdf } from "../src/export/pdf";
import { Manuscript, parseMarkdown, countManuscriptWords } from "../src/export/model";
import { ExportOptions } from "../src/export/headings";

const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  docx: true, epub: true, pdf: true, preset: "trade", minStatus: "draft", lineBreaksAreParagraphs: true, smartQuotes: true,
  sceneBreak: "* * *", chapterStyle: "number-title", actTitles: true, trimSize: "5.5x8.5", ...over,
});

const sentence = 'She said, "We can\'t stay here—not after what the *old* ones did." The wind **howled** across the ridge, and Mara counted the lanterns again, one by one, because counting was all that kept her from running.';
const para = Array.from({ length: 6 }, () => sentence).join(" ");
const md = (n: number) => Array.from({ length: n }, (_, i) => (i === 2 ? "* * *" : para)).join("\n\n");

function manuscript(): Manuscript {
  const scene = (t: string, n: number) => ({ title: t, blocks: parseMarkdown(md(n), { lineBreaksAreParagraphs: true, smartQuotes: true }) });
  const m: Manuscript = {
    title: "The Long Dark", subtitle: "A Novel", author: "Jo Writer", surname: "Writer", contact: "Jo Writer\n1 Main St\njo@example.com",
    language: "en", words: 0, dedication: "For everyone who waited.", copyright: "Copyright © 2026 Jo Writer\nAll rights reserved.",
    about: "Jo writes.", coverPath: null, identifier: "urn:uuid:test",
    acts: [
      { title: "Beginnings", titled: true, number: 1, chapters: [
        { title: "The Ridge", number: 1, scenes: [scene("a", 8), scene("b", 6)] },
        { title: "Chapter 2", number: 2, scenes: [scene("c", 10)] },
      ] },
      { title: "Endings", titled: true, number: 2, chapters: [{ title: "The Fall", number: 3, scenes: [scene("d", 12)] }] },
    ],
  };
  m.words = countManuscriptWords(m);
  return m;
}

const out = process.env.BOOKER_OUT;
const save = (name: string, data: ArrayBuffer) => {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/${name}`, Buffer.from(data));
};

describe("exports", () => {
  it("builds a manuscript-format docx", async () => {
    const data = await buildDocx(manuscript(), opts({ preset: "manuscript" }), "#");
    save("manuscript.docx", data);
    const zip = await JSZip.loadAsync(data);
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("THE LONG DARK");
    expect(doc).toContain("Chapter 1");
    expect(doc).toContain("THE END");
    expect(await zip.file("word/header1.xml")!.async("string")).toContain("Writer");
  });

  it("builds a book-format docx", async () => {
    const data = await buildDocx(manuscript(), opts(), "* * *");
    save("book.docx", data);
    expect((await JSZip.loadAsync(data)).file("word/document.xml")).toBeTruthy();
  });

  it("mirrors margins in the book look, not the manuscript, unless asked", async () => {
    const settings = async (o: any) => (await (await JSZip.loadAsync(await buildDocx(manuscript(), o, "* * *"))).file("word/settings.xml")!.async("string"));
    const book = await settings(opts());
    expect(book).toContain("<w:mirrorMargins/>");
    const order = [...book.matchAll(/<(w:\w+)/g)].map((m) => m[1]);
    expect(order.indexOf("w:mirrorMargins")).toBeGreaterThan(order.indexOf("w:displayBackgroundShape"));
    expect(order.indexOf("w:mirrorMargins")).toBeLessThan(order.indexOf("w:defaultTabStop"));
    expect(await settings(opts({ preset: "manuscript" }))).not.toContain("mirrorMargins");
    expect(await settings(opts({ preset: "manuscript", advanced: { mirrorMargins: "on" } }))).toContain("<w:mirrorMargins/>");
    expect(await settings(opts({ advanced: { mirrorMargins: "off" } }))).not.toContain("mirrorMargins");
  });

  it("picks the scene break mark from the chosen style", () => {
    expect(breakMark({ sceneBreak: "~", breakStyle: undefined })).toBe("~");
    expect(breakMark({ sceneBreak: "~", breakStyle: "stars" })).toBe("* * *");
    expect(breakMark({ sceneBreak: "~", breakStyle: "space" })).toBe("\u00A0");
  });

  it("builds a valid-looking epub", async () => {
    const data = await buildEpub(manuscript(), opts(), "* * *", null);
    save("book.epub", data);
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe("mimetype");
    expect(await zip.file("mimetype")!.async("string")).toBe("application/epub+zip");
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("<dc:title>The Long Dark</dc:title>");
    expect(names.filter((n) => n.includes("/text/ch")).length).toBe(3);
    const ch1 = await zip.file("OEBPS/text/ch001.xhtml")!.async("string");
    expect(ch1).toContain("<em>old</em>");
    expect(ch1).toContain('class="scenebreak"');
    expect(ch1).toContain("“");
    // every manifest href exists
    for (const m of opf.matchAll(/href="([^"]+)"/g)) expect(names).toContain(`OEBPS/${m[1]}`);
  });

  it("builds a book-format pdf with the right number of chapters and page numbers", async () => {
    const data = await buildPdf(manuscript(), opts(), "* * *");
    save("book.pdf", data);
    const pdf = await PDFDocument.load(data);
    expect(pdf.getPageCount()).toBeGreaterThan(10);
    expect(pdf.getTitle()).toBe("The Long Dark");
  });

  it("builds a manuscript-format pdf", async () => {
    const data = await buildPdf(manuscript(), opts({ preset: "manuscript" }), "#");
    save("manuscript.pdf", data);
    const pdf = await PDFDocument.load(data);
    expect(pdf.getPageCount()).toBeGreaterThan(20);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });
});
