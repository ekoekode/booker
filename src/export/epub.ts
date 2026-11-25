import JSZip from "jszip";
import { actHeading, chapterHeading, ExportOptions } from "./headings";
import { Block, cleanManuscript, Manuscript, Run } from "./model";
import { cleanXml } from "../text";
import { FONT_FILES } from "./fonts";
import { resolveLayout } from "./layout";
import { isFontStyle, OPENING_FONT_FAMILY, resolveOpening, type Opening } from "../writing/initials";
import { ILLUMINATED, OPENING_FONT_FILES } from "../writing/initialsData";
import { scriptSegments } from "./script";
import { bookNotes, chapterNotes, hasNotes, numberNotes, type NoteItem } from "./notes";

export function esc(s: string): string {
  return cleanXml(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Where a note's mark points, and what the note's own entry is called, so the two link to each other. */
interface NoteLinks {
  mark(r: Run): { href: string; id: string };
}

function runsHtml(rs: Run[], links?: NoteLinks): string {
  return rs
    .map((r) => {
      if (r.note && links) {
        const l = links.mark(r);
        return `<a epub:type="noteref" role="doc-noteref" id="${l.id}" href="${l.href}"><sup>${r.noteNo}</sup></a>`;
      }
      let t = scriptSegments(r.text).map((g) => (g.he ? `<span class="he" lang="he" dir="rtl">${esc(g.t)}</span>` : esc(g.t))).join("");
      if (r.s) t = `<del>${t}</del>`;
      if (r.sup) t = `<sup>${t}</sup>`;
      if (r.i) t = `<em>${t}</em>`;
      if (r.b) t = `<strong>${t}</strong>`;
      return t;
    })
    .join("");
}

export function blocksHtml(blocks: Block[], breakMark: string, startsAfterBreak: boolean, links?: NoteLinks): string {
  const out: string[] = [];
  // list items are collected and joined once, not merged by repeated string replace
  let list: { tag: string; items: string[] } | null = null;
  const closeList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  };
  let first = true;
  for (const b of blocks) {
    if (b.kind !== "li") closeList();
    switch (b.kind) {
      case "p":
        out.push(`<p${first || startsAfterBreak && first ? ' class="first"' : ""}>${runsHtml(b.runs, links)}</p>`);
        first = false;
        break;
      case "quote":
        out.push(`<blockquote><p>${runsHtml(b.runs, links)}</p></blockquote>`);
        first = false;
        break;
      case "date": {
        const s = b.style;
        out.push(`<p class="scenedate" style="text-align:${s.align};font-size:${s.size}%;text-indent:0;${s.italic ? "font-style:italic;" : ""}${s.bold ? "font-weight:bold;" : ""}margin:0.6em 0 0.8em">${runsHtml(b.runs, links)}</p>`);
        first = true;
        break;
      }
      case "h":
        out.push(`<h3 class="inline-heading">${runsHtml(b.runs, links)}</h3>`);
        break;
      case "li": {
        const tag = b.ordered ? "ol" : "ul";
        if (list && list.tag !== tag) closeList();
        if (!list) list = { tag, items: [] };
        list.items.push(`<li>${runsHtml(b.runs, links)}</li>`);
        break;
      }
      case "rule":
        out.push(`<p class="scenebreak">${esc(breakMark)}</p>`);
        first = true;
        break;
    }
  }
  closeList();
  return out.join("\n");
}

/** Give the first paragraph of a chapter its large opening letter. `art` is the illuminated image's file name when that style is chosen. */
export function withDropCap(body: string, opening: Opening | undefined, artFile: (ch: string) => string): { html: string; used: string | null } {
  const o = resolveOpening(opening);
  if (o.style === "off") return { html: body, used: null };
  const m = /<p class="first">([A-Za-z])([\s\S]*?)<\/p>/.exec(body);
  if (!m) return { html: body, used: null };
  const ch = m[1].toUpperCase();
  const lead = o.style === "art" ? `<img class="initial art lines${o.lines}" src="../images/initials/${artFile(ch)}" alt="${ch}"/>` : `<span class="initial ${o.style} frame-${o.frame} lines${o.lines}">${ch}</span>`;
  return { html: body.slice(0, m.index) + `<p class="first dropcap">${lead}${m[2]}</p>` + body.slice(m.index + m[0].length), used: o.style === "art" ? ch : null };
}

function xhtml(title: string, lang: string, body: string, cls = ""): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body${cls ? ` class="${cls}"` : ""}>
${body}
</body>
</html>`;
}

const CSS = `@font-face { font-family: "Literata"; font-weight: normal; font-style: normal; src: url("../fonts/Literata-Regular.ttf"); }
@font-face { font-family: "Literata"; font-weight: normal; font-style: italic; src: url("../fonts/Literata-Italic.ttf"); }
@font-face { font-family: "Literata"; font-weight: bold; font-style: normal; src: url("../fonts/Literata-Bold.ttf"); }
@font-face { font-family: "Literata"; font-weight: bold; font-style: italic; src: url("../fonts/Literata-BoldItalic.ttf"); }

html { font-size: 100%; }
body { font-family: "Literata", Georgia, "Times New Roman", serif; line-height: 1.45; margin: 0; padding: 0 2%; orphans: 2; widows: 2; hyphens: auto; -webkit-hyphens: auto; text-align: left; }
p { margin: 0; text-indent: 1.3em; text-align: justify; }
p.first, h1 + p, h2 + p, h3 + p, .scenebreak + p, blockquote + p { text-indent: 0; }
.scenebreak { text-indent: 0; text-align: center; margin: 1.4em 0; letter-spacing: 0.3em; page-break-after: avoid; }
blockquote { margin: 1em 1.6em; font-style: italic; }
blockquote p { text-indent: 0; }
h1, h2, h3 { font-weight: normal; text-align: center; page-break-after: avoid; hyphens: none; -webkit-hyphens: none; }
.chapter-label { font-size: 0.85em; letter-spacing: 0.25em; text-transform: uppercase; margin: 3.5em 0 0.4em; }
.chapter-title { font-size: 1.6em; font-style: italic; margin: 0 0 2em; }
.chapter-label.only { margin-bottom: 2em; }
.inline-heading { font-size: 1.1em; font-weight: bold; margin: 1.5em 0 0.8em; }
.act { text-align: center; margin-top: 30vh; }
.act h1 { font-size: 1.8em; letter-spacing: 0.08em; }
.title-page { text-align: center; margin-top: 25vh; }
.title-page h1 { font-size: 2.2em; margin: 0 0 0.3em; font-weight: bold; }
.title-page .subtitle { font-style: italic; font-size: 1.15em; margin-bottom: 2.4em; text-align: center; text-indent: 0; }
.title-page .author { font-size: 1.2em; letter-spacing: 0.1em; text-align: center; text-indent: 0; }
.copyright p { font-size: 0.8em; text-indent: 0; text-align: left; margin: 0.6em 0; }
.copyright { margin-top: 40vh; }
.dedication { margin-top: 25vh; text-align: center; font-style: italic; }
.dedication p { text-align: center; text-indent: 0; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100vh; }
.he { font-family: "Ezra SIL", "SBL Hebrew", "Noto Serif Hebrew", "Times New Roman", serif; unicode-bidi: isolate; }
.about h1 { font-size: 1.4em; font-weight: bold; margin: 2em 0 1em; }
a.noteref, a[epub|type~="noteref"] { text-decoration: none; font-size: 0.8em; }
.notes { margin-top: 2.5em; border-top: 1px solid #999; padding-top: 0.8em; font-size: 0.85em; }
.notes h2 { font-size: 1em; font-weight: bold; font-style: normal; text-align: left; margin: 0 0 0.6em; }
.notes h3 { font-size: 0.95em; font-weight: bold; text-align: left; margin: 1.2em 0 0.4em; }
.notes aside { margin: 0 0 0.4em; }
.notes aside p { text-indent: 0; text-align: left; margin: 0; }
`;

interface Item {
  id: string;
  href: string;
  title: string;
  html: string;
  nav: boolean;
  props?: string;
}

const noteId = (chapter: number, n: number) => `c${chapter}n${n}`;

function noteEntry(it: NoteItem, chapter: number, back: string): string {
  return `<aside epub:type="footnote" role="doc-footnote" id="fn-${noteId(chapter, it.n)}"><p>${it.n}. ${runsHtml(it.runs)} <a href="${back}#fnref-${noteId(chapter, it.n)}" role="doc-backlink">\u21A9</a></p></aside>`;
}

export async function buildEpub(m0: Manuscript, opts: ExportOptions, breakMark0: string, cover: { data: ArrayBuffer; ext: string } | null): Promise<ArrayBuffer> {
  const placement = opts.notePlacement === "book" ? "book" : "chapter"; // an ePub has no pages: foot of the page means the end of the chapter
  const m = numberNotes(cleanManuscript(m0), opts.noteNumbering ?? "chapter");
  const breakMark = cleanXml(breakMark0);
  const lang = m.language || "en";
  const items: Item[] = [];
  const artUsed = new Set<string>();
  const opening = resolveOpening(opts.opening);
  const add = (id: string, title: string, html: string, nav = true, props?: string) => items.push({ id, href: `text/${id}.xhtml`, title, html: xhtml(title, lang, html, id.startsWith("ch") ? "chapter" : ""), nav, props });

  if (cover) add("cover", "Cover", `<div class="cover"><img src="../images/cover.${cover.ext}" alt="Cover of ${esc(m.title)}"/></div>`, false, "svg");
  add(
    "title",
    "Title Page",
    `<div class="title-page"><h1>${esc(m.title)}</h1>${m.subtitle ? `<p class="subtitle">${esc(m.subtitle)}</p>` : ""}<p class="author">${esc(m.author)}</p></div>`,
    false
  );
  if (m.copyright) add("copyright", "Copyright", `<div class="copyright">${m.copyright.split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join("")}</div>`, false);
  if (m.dedication) add("dedication", "Dedication", `<div class="dedication"><p>${esc(m.dedication)}</p></div>`, false);

  for (const act of m.acts) {
    if (act.titled && opts.actTitles) {
      add(`act${act.number}`, actHeading(act), `<div class="act"><h1>${esc(actHeading(act))}</h1></div>`);
    }
    for (const ch of act.chapters) {
      const h = chapterHeading(ch, opts.chapterStyle);
      const navTitle = [h.label, h.title].filter(Boolean).join(": ") || ch.title;
      const head = `${h.label ? `<h1 class="chapter-label${h.title ? "" : " only"}">${esc(h.label)}</h1>` : ""}${h.title ? `<h2 class="chapter-title">${esc(h.title)}</h2>` : ""}`;
      const file = `ch${String(ch.number).padStart(3, "0")}`;
      const links: NoteLinks = {
        mark: (r) => ({ id: `fnref-${noteId(ch.number, r.noteNo!)}`, href: `${placement === "book" ? "notes.xhtml" : ""}#fn-${noteId(ch.number, r.noteNo!)}` }),
      };
      const body = ch.scenes.map((sc, i) => (i > 0 ? `<p class="scenebreak">${esc(breakMark)}</p>\n` : "") + blocksHtml(sc.blocks, breakMark, i > 0, links)).join("\n");
      const notes = chapterNotes(ch);
      const tail = placement === "chapter" && notes.length ? `\n<section class="notes" epub:type="footnotes"><h2>Notes</h2>\n${notes.map((n) => noteEntry(n, ch.number, "")).join("\n")}</section>` : "";
      const dc = withDropCap(body, opts.opening, (c) => `${c}.png`);
      if (dc.used) artUsed.add(dc.used);
      add(file, navTitle, head + "\n" + dc.html + tail);
    }
  }
  if (placement === "book" && hasNotes(m)) {
    const groups = bookNotes(m)
      .map(({ chapter, notes }) => {
        const h = chapterHeading(chapter, opts.chapterStyle);
        const label = [h.label, h.title].filter(Boolean).join(": ") || chapter.title;
        return `<h3>${esc(label)}</h3>\n${notes.map((n) => noteEntry(n, chapter.number, `ch${String(chapter.number).padStart(3, "0")}.xhtml`)).join("\n")}`;
      })
      .join("\n");
    add("notes", "Notes", `<section class="notes" epub:type="endnotes"><h2>Notes</h2>\n${groups}</section>`);
  }
  if (m.about) add("about", "About the Author", `<div class="about"><h1>About the Author</h1>${m.about.split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join("")}</div>`);

  const navItems = items.filter((i) => i.nav);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const navHtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}">
<head><meta charset="utf-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="styles/book.css"/></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol style="list-style:none;padding:0">
${navItems.map((i) => `<li><a href="${i.href}">${esc(i.title)}</a></li>`).join("\n")}
</ol></nav>
<nav epub:type="landmarks" hidden="hidden"><ol>
<li><a epub:type="bodymatter" href="${(navItems[0] ?? items[0]).href}">Start</a></li>
</ol></nav>
</body></html>`;

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${esc(m.identifier)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(m.title)}</text></docTitle>
<navMap>
${navItems.map((i, n) => `<navPoint id="np${n + 1}" playOrder="${n + 1}"><navLabel><text>${esc(i.title)}</text></navLabel><content src="${i.href}"/></navPoint>`).join("\n")}
</navMap></ncx>`;

  const mediaType = (ext: string) => (ext === "png" ? "image/png" : "image/jpeg");
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles/book.css" media-type="text/css"/>`,
    ...FONT_FILES.map((f, i) => `<item id="font${i}" href="fonts/${f.name}" media-type="font/ttf"/>`),
    ...(isFontStyle(opening.style) ? [`<item id="fontopen" href="fonts/${OPENING_FONT_FILES[opening.style].name}" media-type="font/ttf"/>`] : []),
    ...[...artUsed].sort().map((c) => `<item id="ini${c}" href="images/initials/${c}.png" media-type="image/png"/>`),
    ...(cover ? [`<item id="cover-image" href="images/cover.${cover.ext}" media-type="${mediaType(cover.ext)}" properties="cover-image"/>`] : []),
    ...items.map((i) => `<item id="${i.id}" href="${i.href}" media-type="application/xhtml+xml"${i.props ? ` properties="${i.props}"` : ""}/>`),
  ].join("\n");
  const spine = items.map((i) => `<itemref idref="${i.id}"${i.id === "cover" ? ' linear="yes"' : ""}/>`).join("\n");

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${esc(m.identifier)}</dc:identifier>
<dc:title>${esc(m.title)}</dc:title>
<dc:creator>${esc(m.author)}</dc:creator>
<dc:language>${esc(lang)}</dc:language>
${m.subtitle ? `<dc:description>${esc(m.subtitle)}</dc:description>` : ""}
<meta property="dcterms:modified">${modified}</meta>
${cover ? `<meta name="cover" content="cover-image"/>` : ""}
</metadata>
<manifest>
${manifest}
</manifest>
<spine toc="ncx">
${spine}
</spine>
<guide>
<reference type="text" title="Start" href="${(navItems[0] ?? items[0]).href}"/>
</guide>
</package>`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  );
  zip.file("OEBPS/content.opf", opf);
  zip.file("OEBPS/nav.xhtml", navHtml);
  zip.file("OEBPS/toc.ncx", ncx);
  zip.file("OEBPS/styles/book.css", CSS + openingCss(opening) + epubOverrides(opts));
  if (isFontStyle(opening.style)) zip.file(`OEBPS/fonts/${OPENING_FONT_FILES[opening.style].name}`, OPENING_FONT_FILES[opening.style].data);
  for (const c of artUsed) zip.file(`OEBPS/images/initials/${c}.png`, ILLUMINATED[c]);
  for (const f of FONT_FILES) zip.file(`OEBPS/fonts/${f.name}`, f.data);
  if (cover) zip.file(`OEBPS/images/cover.${cover.ext}`, cover.data);
  for (const i of items) zip.file(`OEBPS/${i.href}`, i.html);
  return zip.generateAsync({ type: "arraybuffer", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

/** The styles of the chapter opening letter: as tall as N lines of the book's 1.45 line height, with the text wrapping beside and under it. */
export function openingCss(o: Opening): string {
  if (o.style === "off") return "";
  const n = o.lines;
  const out = [`p.dropcap { text-indent: 0; }`, `.initial { float: left; line-height: 1; text-indent: 0; }`];
  if (o.style === "art") {
    out.push(`img.initial.art { height: ${(n * 1.45).toFixed(2)}em; width: auto; margin: 0 0.1em 0 0; }`);
  } else {
    const f = OPENING_FONT_FILES[o.style];
    out.push(`@font-face { font-family: "${OPENING_FONT_FAMILY[o.style]}"; font-weight: ${f.weight}; src: url("../fonts/${f.name}"); }`);
    const size = o.frame === "double" ? 0.72 : 0.82;
    out.push(`.initial.${o.style} { font-family: "${OPENING_FONT_FAMILY[o.style]}", serif; font-weight: ${f.weight}; font-size: ${(n * 1.45 * size).toFixed(2)}em; margin: 0.02em 0.1em 0 0; color: #000; }`);
    if (o.frame === "block") out.push(`.initial.frame-block { background: #000; color: #fff; padding: 0.04em 0.12em 0; margin-right: 0.12em; }`);
    if (o.frame === "single") out.push(`.initial.frame-single { border: 0.05em solid #000; padding: 0.03em 0.1em 0; margin-right: 0.12em; }`);
    if (o.frame === "double") out.push(`.initial.frame-double { border: 0.1em double #000; padding: 0.03em 0.1em 0; margin-right: 0.12em; }`);
  }
  return "\n/* chapter opening */\n" + out.join("\n") + "\n";
}

/** CSS appended after the base styles: only what the Advanced window changed, so a reader's own settings still win elsewhere. */
export function epubOverrides(opts: Pick<ExportOptions, "trimSize" | "advanced">): string {
  const a = opts.advanced ?? {};
  const rl = resolveLayout({ preset: "trade", trimSize: opts.trimSize, advanced: a });
  const out: string[] = [];
  if (rl.fontChosen) out.push(`body { font-family: ${rl.cssFont}; }`);
  if (a.lineSpacing !== undefined) out.push(`body { line-height: ${rl.line}; }`);
  if (a.firstLineIndent !== undefined) out.push(`p { text-indent: ${rl.indent}in; }`);
  if (a.paragraphSpacing !== undefined) out.push(`p { margin: 0 0 ${rl.paraAfter}pt; }`);
  if (a.justify && a.justify !== "default") out.push(`p { text-align: ${rl.justify ? "justify" : "left"}; }`);
  return out.length ? "\n/* advanced */\n" + out.join("\n") + "\n" : "";
}
