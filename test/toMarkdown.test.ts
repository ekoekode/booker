import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxToMarkdown, epubToMarkdown, joinPieces, odtToMarkdown, xhtmlToMarkdown } from "../src/import/toMarkdown";
import { planMarkdownImport, planTotals } from "../src/project/mdImport";

const w = (inner: string) => `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${inner}</w:body></w:document>`;
const para = (text: string, style = "", extra = "") => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r>${extra}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("joinPieces", () => {
  it("wraps a run once and keeps spaces outside the marks", () => {
    expect(joinPieces([{ text: "a ", b: true }, { text: "b ", b: true }, { text: "c" }])).toBe("**a b** c");
    expect(joinPieces([{ text: "x", i: true }])).toBe("*x*");
  });
});

describe("docx", () => {
  it("makes headings, emphasis and footnotes, and the result imports as chapters", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      w(
        para("Part One", "Heading1") +
          para("The Door", "Heading2") +
          para("Plain ") .replace("</w:p>", "<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:footnoteReference w:id=\"2\"/></w:r></w:p>") +
          para("***") +
          para("Second &amp; last.")
      )
    );
    zip.file("word/footnotes.xml", `<w:footnotes xmlns:w="x"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>-</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>A note.</w:t></w:r></w:p></w:footnote></w:footnotes>`);
    const md = await docxToMarkdown(await zip.generateAsync({ type: "arraybuffer" }));
    expect(md).toContain("# Part One\n\n## The Door");
    expect(md).toContain("Plain **bold**^[A note.]");
    expect(md).toContain("Second & last.");
    expect(md).not.toContain("separator");
    const t = planTotals(planMarkdownImport(md));
    expect(t.sections).toBeGreaterThan(0);
  });
  it("refuses something that is not Word", async () => {
    const zip = new JSZip();
    zip.file("a.txt", "x");
    await expect(docxToMarkdown(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow(/Word/);
  });
});

describe("odt", () => {
  it("reads headings, bold spans and notes", async () => {
    const zip = new JSZip();
    zip.file(
      "content.xml",
      `<office:document-content><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">Chapter One</text:h><text:p>He said <text:span text:style-name="T1">no</text:span>.<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>See above.</text:p></text:note-body></text:note></text:p></office:text></office:body></office:document-content>`
    );
    const md = await odtToMarkdown(await zip.generateAsync({ type: "arraybuffer" }));
    expect(md).toBe("# Chapter One\n\nHe said **no**.^[See above.]");
  });
});

describe("epub", () => {
  it("follows the spine and converts the chapters", async () => {
    const zip = new JSZip();
    zip.file("META-INF/container.xml", `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`);
    zip.file("OEBPS/content.opf", `<package><manifest><item id="c1" href="c1.xhtml"/><item id="nav" href="nav.xhtml"/></manifest><spine><itemref idref="nav"/><itemref idref="c1"/></spine></package>`);
    zip.file("OEBPS/c1.xhtml", `<html><body><h1>One</h1><p>Hello <em>there</em> &amp; you.</p><hr/><p>More.</p></body></html>`);
    zip.file("OEBPS/nav.xhtml", `<html><body><h1>Contents</h1></body></html>`);
    expect(await epubToMarkdown(await zip.generateAsync({ type: "arraybuffer" }))).toBe("# One\n\nHello *there* & you.\n\n***\n\nMore.");
  });
  it("drops a title page that is only a heading, and keeps a Part page", async () => {
    const zip = new JSZip();
    zip.file("META-INF/container.xml", `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`);
    zip.file("content.opf", `<package><manifest><item id="t" href="t.xhtml"/><item id="p" href="p.xhtml"/><item id="c" href="c.xhtml"/></manifest><spine><itemref idref="t"/><itemref idref="p"/><itemref idref="c"/></spine></package>`);
    zip.file("t.xhtml", `<html><body><h1>My Book</h1></body></html>`);
    zip.file("p.xhtml", `<html><body><h1>Part One</h1></body></html>`);
    zip.file("c.xhtml", `<html><body><h2>Chapter 1</h2><p>Text.</p></body></html>`);
    expect(await epubToMarkdown(await zip.generateAsync({ type: "arraybuffer" }))).toBe("# Part One\n\n## Chapter 1\n\nText.");
  });
  it("converts a blockquote", () => {
    expect(xhtmlToMarkdown("<body><blockquote><p>Q one</p><p>Q two</p></blockquote></body>")).toBe("> Q one\n> Q two");
  });
});

import { parseMarkdown, plainText } from "../src/export/model";
describe("callouts in export", () => {
  const opts = { lineBreaksAreParagraphs: false, smartQuotes: false };
  const text = (md: string) => parseMarkdown(md, opts).map((b) => (b.kind === "rule" ? "" : plainText(b.runs)));
  it("leads with the title, or the kind when there is none", () => {
    expect(text("> [!summary] In short\n> Grace wins.")).toEqual(["In short. Grace wins."]);
    expect(text("> [!question]\n> What is grace?")).toEqual(["Question. What is grace?"]);
  });
  it("prints an epigraph as a plain quote", () => {
    expect(text("> [!epigraph]\n> In the beginning.")).toEqual(["In the beginning."]);
  });
  it("leaves ordinary quotes alone", () => {
    expect(text("> Just a quote.")).toEqual(["Just a quote."]);
  });
});
