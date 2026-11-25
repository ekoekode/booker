#!/usr/bin/env node
// Builds docs/GUIDE.html and docs/Booker-User-Guide.pdf from docs/GUIDE.md.
// Usage: node scripts/build-guide.mjs   (needs `marked`, and the html2pdf tool)
// The PDF tool is only ever run from $HTML2PDF or ./tools/html2pdf. Build it from the repo source with:
//   swiftc tools/html2pdf.swift -o tools/html2pdf
// (this script does that automatically when ./tools/html2pdf is missing and $HTML2PDF is unset).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "docs", "GUIDE.md");
const htmlPath = join(root, "docs", "GUIDE.html");
const pdfPath = join(root, "docs", "Booker-User-Guide.pdf");
const tool = process.env.HTML2PDF || join(root, "tools", "html2pdf");

let md = readFileSync(src, "utf8");
md = md.replace(/^# .*\n/, ""); // the cover block carries the title

// Version on the cover block comes from manifest.json, so the guide never states an old one.
const { version } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
md = md.replace(/^Version .*\n+/m, ""); // shown on the cover instead

// Sections (## in the file) become the top-level headings of the PDF, so each starts a new page.
// Every heading gets an id, and the contents page at the front links to them.
const slugs = new Map();
const toc = [];
const plain = (t) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const marked = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const level = Math.max(1, depth - 1);
      const inner = this.parser.parseInline(tokens);
      let id = plain(inner).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
      const n = slugs.get(id) ?? 0;
      slugs.set(id, n + 1);
      if (n) id = `${id}-${n + 1}`;
      if (level <= 2) toc.push({ level, id, text: plain(inner) });
      return `<h${level} id="${id}">${inner}</h${level}>\n`;
    },
  },
});
const body = marked.parse(md);
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const contents = `<div class="toc"><h1 class="toc-title">Contents</h1>
<ul class="toc-list">
${toc.map((t) => `<li class="toc-${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join("\n")}
</ul></div>
`;

const d = new Date();
const date = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const css = `
@page { size: 8.5in 11in; margin: 0.75in; }
html { -webkit-text-size-adjust: none; }
body { margin: 0; padding: 0 54pt; font-family: Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.45; color: #1c1c1c; }
h1, h2, h3, h4 { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; page-break-after: avoid; break-after: avoid; line-height: 1.2; }
h1 { font-size: 22pt; margin: 0 0 14pt; page-break-before: always; break-before: page; padding-bottom: 6pt; border-bottom: 1px solid #bbb; }
.toc-title { margin-bottom: 8pt; }
.toc-list { list-style: none; padding: 0; margin: 4pt 0 0; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 9.6pt; line-height: 1.3; }
.toc-list li { margin: 0 0 2.4pt; break-inside: avoid; }
.toc-list .toc-2 { margin-left: 14pt; font-size: 8.8pt; color: #555; }
.toc-list a { color: #1c1c1c; }
h2 { font-size: 14.5pt; margin: 20pt 0 6pt; }
h3 { font-size: 12pt; margin: 14pt 0 4pt; }
p { margin: 0 0 8pt; }
ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
li { margin: 0 0 3pt; }
a { color: #1c1c1c; text-decoration: none; }
img { max-width: 100%; max-height: 7.2in; border: 1px solid #ccc; border-radius: 4pt; display: block; margin: 8pt auto 2pt; page-break-inside: avoid; break-inside: avoid; }
p > em:only-child { display: block; text-align: center; font-size: 9pt; color: #555; margin-bottom: 10pt; }
code { font-family: Menlo, Courier, monospace; font-size: 9.5pt; background: #efefef; padding: 0 2pt; border-radius: 2pt; }
pre { background: #efefef; padding: 8pt 10pt; border-radius: 3pt; font-size: 8.5pt; line-height: 1.35; white-space: pre-wrap; page-break-inside: avoid; margin: 0 0 10pt; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; font-size: 9.5pt; line-height: 1.35; }
th, td { border: 1px solid #ccc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f3f3f3; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 9pt; }
tr { page-break-inside: avoid; break-inside: avoid; }
.cover { padding-top: 220pt; text-align: center; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; height: 330pt; }
.cover .title { font-size: 34pt; font-weight: 700; margin: 0 0 10pt; }
.cover .sub { font-size: 13pt; color: #555; }
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Booker: User Guide</title><style>${css}</style></head>
<body>
<div class="cover"><div class="title">Booker: User Guide</div><div class="sub">Version ${version} · ${date}</div></div>
${contents}${body}
</body></html>
`;
writeFileSync(htmlPath, html);
console.log(`Wrote ${htmlPath}`);

if (!existsSync(tool) && !process.env.HTML2PDF) {
  const swiftSrc = join(root, "tools", "html2pdf.swift");
  if (existsSync(swiftSrc)) {
    try {
      console.log("Building tools/html2pdf with swiftc…");
      execFileSync("swiftc", [swiftSrc, "-o", tool], { stdio: "inherit", timeout: 300000 });
    } catch (e) {
      console.error(`Could not build the PDF tool: ${e.message}`);
    }
  }
}
if (!existsSync(tool)) {
  console.error(`PDF tool not found at ${tool}. HTML is ready; build the PDF later.`);
  process.exit(1);
}
try { unlinkSync(pdfPath); } catch {}
execFileSync(tool, [htmlPath, pdfPath], { stdio: "inherit", timeout: 120000 });
const size = statSync(pdfPath).size;
if (size > 20 * 1024 * 1024) {
  unlinkSync(pdfPath);
  console.error(`PDF was ${size} bytes, which is too large. Removed it.`);
  process.exit(1);
}
console.log(`Wrote ${pdfPath} (${(size / 1024).toFixed(0)} KB)`);
