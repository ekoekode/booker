import JSZip from "jszip";
import { rtfToMarkdown } from "./rtf";

/** Word, OpenDocument and ePub files turned into Markdown, so one importer (planMarkdownImport) handles them all. */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });

interface Piece {
  text: string;
  b?: boolean;
  i?: boolean;
}

/** Join pieces of text, wrapping bold and italic runs once even when Word split them in several. */
export function joinPieces(pieces: Piece[]): string {
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && !!last.b === !!p.b && !!last.i === !!p.i) last.text += p.text;
    else merged.push({ ...p });
  }
  return merged
    .map((p) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p.text)!;
      if (!m[2]) return p.text;
      const mark = p.b && p.i ? "***" : p.b ? "**" : p.i ? "*" : "";
      return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
    })
    .join("");
}

const on = (xml: string, tag: string) => new RegExp(`<${tag}(?:\\s[^>]*)?/?>`).test(xml) && !new RegExp(`<${tag}\\s[^>]*w:val="(?:0|false|none)"`).test(xml);

/** The text of a paragraph's runs, with footnote marks `[^n]` where Word has them. */
function wordRuns(p: string): string {
  const pieces: Piece[] = [];
  for (const r of p.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? []) {
    const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r)?.[1] ?? "";
    const b = on(props, "w:b");
    const i = on(props, "w:i");
    const ref = /<w:footnoteReference[^>]*w:id="(\d+)"/.exec(r);
    if (ref) {
      pieces.push({ text: `[^${ref[1]}]` });
      continue;
    }
    let text = "";
    for (const m of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) text += m[1] !== undefined ? unescapeXml(m[1]) : m[0].startsWith("<w:tab") ? " " : "\n";
    if (text) pieces.push({ text, b, i });
  }
  return joinPieces(pieces);
}

export async function docxToMarkdown(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const doc = await zip.file("word/document.xml")?.async("string");
  if (!doc) throw new Error("This is not a Word (.docx) file.");
  const out: string[] = [];
  for (const p of doc.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []) {
    const text = wordRuns(p).trim();
    if (!text) continue;
    const style = /<w:pStyle[^>]*w:val="([^"]+)"/.exec(p)?.[1] ?? "";
    const h = /^heading\s*(\d)$/i.exec(style) ?? (/^title$/i.test(style) ? [0, "1"] : null);
    if (/^BookerChapterTitle$/i.test(style) && /^#{1,6} /.test(out[out.length - 1] ?? "")) out[out.length - 1] += `: ${text.replace(/\*+/g, "")}`; // a title under its "Chapter 1" heading
    else if (h) out.push(`${"#".repeat(Math.min(6, Number(h[1])))} ${text.replace(/\*+/g, "")}`);
    else if (/<w:numPr>/.test(p)) out.push(`- ${text}`);
    else if (/^(quote|intensequote|blocktext)$/i.test(style)) out.push(`> ${text}`);
    else out.push(text);
  }
  let md = out.join("\n\n");
  const notes = await zip.file("word/footnotes.xml")?.async("string");
  if (notes) {
    // inline notes (^[text]) travel with their paragraph, so splitting the text into scenes cannot part a note from its mark
    const defs = new Map<string, string>();
    for (const m of notes.matchAll(/<w:footnote\b([^>]*)>([\s\S]*?)<\/w:footnote>/g)) {
      const id = /w:id="(-?\d+)"/.exec(m[1])?.[1];
      if (!id || Number(id) < 1 || /w:type="/.test(m[1])) continue;
      const body = (m[2].match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []).map((p) => wordRuns(p).trim()).filter(Boolean).join(" ");
      if (body) defs.set(id, body);
    }
    md = md.replace(/\[\^(\d+)\]/g, (m, id: string) => (defs.has(id) ? `^[${defs.get(id)}]` : ""));
  }
  return md;
}

/** Styles of an OpenDocument file that are bold or italic, by name. */
function odtStyles(xml: string): Record<string, { b: boolean; i: boolean }> {
  const out: Record<string, { b: boolean; i: boolean }> = {};
  for (const m of xml.matchAll(/<style:style\b[^>]*style:name="([^"]+)"[^>]*>([\s\S]*?)<\/style:style>/g)) out[m[1]] = { b: /fo:font-weight="bold"/.test(m[2]), i: /fo:font-style="italic"/.test(m[2]) };
  return out;
}

function odtInline(xml: string, styles: Record<string, { b: boolean; i: boolean }>): string {
  const pieces: Piece[] = [];
  const walk = (s: string, b: boolean, i: boolean) => {
    const re = /<text:span\b[^>]*text:style-name="([^"]+)"[^>]*>([\s\S]*?)<\/text:span>|<text:note\b[\s\S]*?<text:note-body>([\s\S]*?)<\/text:note-body>[\s\S]*?<\/text:note>|<text:s\b[^>]*\/>|<text:tab\s*\/>|<text:line-break\s*\/>|([^<]+)|<[^>]+>/g;
    for (const m of s.matchAll(re)) {
      if (m[1] !== undefined) walk(m[2], b || !!styles[m[1]]?.b, i || !!styles[m[1]]?.i);
      else if (m[3] !== undefined) pieces.push({ text: `^[${odtInline(m[3], styles).replace(/\n+/g, " ").trim()}]` });
      else if (m[4] !== undefined) pieces.push({ text: unescapeXml(m[4]), b, i });
      else if (m[0].startsWith("<text:s") || m[0].startsWith("<text:tab")) pieces.push({ text: " ", b, i });
      else if (m[0].startsWith("<text:line-break")) pieces.push({ text: "\n", b, i });
    }
  };
  walk(xml, false, false);
  return joinPieces(pieces);
}

export async function odtToMarkdown(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("content.xml")?.async("string");
  if (!xml) throw new Error("This is not an OpenDocument (.odt) file.");
  const styles = odtStyles(xml);
  // notes hold paragraphs of their own, so turn them into inline notes before splitting the text into paragraphs
  const body = (/<office:text\b[^>]*>([\s\S]*)<\/office:text>/.exec(xml)?.[1] ?? xml).replace(/<text:note\b[\s\S]*?<text:note-body>([\s\S]*?)<\/text:note-body>[\s\S]*?<\/text:note>/g, (_, inner: string) => `^[${odtInline(inner, styles).replace(/\n+/g, " ").trim()}]`);
  const out: string[] = [];
  for (const m of body.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g)) {
    const text = odtInline(m[3], styles).trim();
    if (!text) continue;
    if (m[1] === "h") out.push(`${"#".repeat(Math.min(6, Number(/text:outline-level="(\d+)"/.exec(m[2])?.[1] ?? 1)))} ${text.replace(/\*+/g, "")}`);
    else out.push(text);
  }
  return out.join("\n\n");
}

/** XHTML of an ePub chapter to Markdown. */
export function xhtmlToMarkdown(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  let s = body
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<hr\b[^>]*\/?>/gi, "\n\n***\n\n")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<br\b[^>]*\/?>/gi, "\n")
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t: string) => `\n\n${t.replace(/<\/?p\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").trim().split(/\n+/).map((l) => `> ${l.trim()}`).join("\n")}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n\n- $1\n\n")
    .replace(/<\/(p|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  s = unescapeXml(s).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export async function epubToMarkdown(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = container && /full-path="([^"]+)"/.exec(container)?.[1];
  const opf = opfPath ? await zip.file(opfPath)?.async("string") : undefined;
  if (!opfPath || !opf) throw new Error("This is not an ePub file.");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const parts: string[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
    const href = manifest.get(m[1]);
    if (!href || /nav|toc/i.test(m[1])) continue;
    const html = await zip.file(dir + href)?.async("string");
    if (html) parts.push(xhtmlToMarkdown(html));
  }
  // a title page is only a heading: it would become an empty chapter. A Part or Act page is only a heading too, and is kept.
  const headingOnly = (s: string) => s.split("\n").every((l) => !l.trim() || /^#{1,6} /.test(l)) && !/^#{1,6}\s*(part|act|book)\b/im.test(s);
  return parts.filter((s) => s && !headingOnly(s)).join("\n\n");
}

/** Markdown from a picked file, by its extension. Plain text and Markdown are passed through. */
export async function fileToMarkdown(name: string, read: { text(): Promise<string>; bytes(): Promise<ArrayBuffer> }): Promise<string> {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "docx") return docxToMarkdown(await read.bytes());
  if (ext === "odt") return odtToMarkdown(await read.bytes());
  if (ext === "rtf") return rtfToMarkdown(await read.text());
  if (ext === "epub") return epubToMarkdown(await read.bytes());
  return read.text();
}
