import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../src/export/fonts", () => {
  const f = (n: string) => new Uint8Array(readFileSync(`assets/fonts/Literata-${n}.ttf`));
  const data = { regular: f("Regular"), italic: f("Italic"), bold: f("Bold"), boldItalic: f("BoldItalic") };
  return { FONTS: data, FONT_FILES: [] };
});

import { buildDocx } from "../src/export/docx";
import { docxToMarkdown } from "../src/import/toMarkdown";
import { Manuscript, parseMarkdown } from "../src/export/model";
import { ExportOptions } from "../src/export/headings";

const opts: ExportOptions = {
  docx: true, epub: false, pdf: false, preset: "trade", minStatus: "draft", lineBreaksAreParagraphs: true, smartQuotes: false,
  sceneBreak: "* * *", chapterStyle: "number-title", actTitles: true, trimSize: "5.5x8.5",
};

const p = (md: string) => parseMarkdown(md, { lineBreaksAreParagraphs: true, smartQuotes: false });
const book: Manuscript = {
  title: "T", subtitle: "", author: "A", surname: "A", contact: "", language: "en", words: 5, dedication: "", copyright: "", about: "", coverPath: null, identifier: "urn:x",
  acts: [
    { title: "Rising", titled: true, number: 1, chapters: [
      { title: "The Mill", number: 1, scenes: [{ title: "s", blocks: p("First scene text.") }] },
      { title: "The River", number: 2, scenes: [{ title: "s", blocks: p("Second chapter text.") }] },
    ] },
  ],
};

describe("Word export, then import", () => {
  it("keeps the act and the chapters as headings", async () => {
    const md = await docxToMarkdown(await buildDocx(book, opts, "* * *"));
    const heads = md.split("\n").filter((l) => /^#{1,6} /.test(l));
    expect(heads.length).toBe(3);
    expect(heads[0]).toMatch(/^# .*Rising/);
    expect(heads[1]).toMatch(/^## .*1.*The Mill/);
    expect(heads[2]).toMatch(/^## .*2.*The River/);
    expect(md).toContain("First scene text.");
  });
});
