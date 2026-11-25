/**
 * Getting searchable text out of source files. Everything here works on strings, so it is testable without a vault;
 * PDF text comes from Obsidian's own PDF engine in the service layer and arrives as one string per page.
 */
import JSZip from "jszip";
import { decodeEntities } from "../scripture/module";
import type { Chunk } from "./types";

const TARGET = 900;

/** Group paragraphs into chunks of about TARGET characters, never splitting a paragraph unless it is huge. */
export function chunkParagraphs(paras: string[], loc: (n: number) => string, page?: number): Chunk[] {
  const out: Chunk[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push({ loc: loc(out.length), ...(page !== undefined && { page }), text: buf.trim() });
    buf = "";
  };
  for (const p0 of paras) {
    let p = p0.replace(/\s+/g, " ").trim();
    if (!p) continue;
    while (p.length > TARGET * 2) {
      let cut = p.lastIndexOf(" ", TARGET * 1.5);
      if (cut < TARGET) cut = TARGET;
      if (buf) flush();
      buf = p.slice(0, cut);
      flush();
      p = p.slice(cut).trim();
    }
    if (buf && buf.length + p.length > TARGET) flush();
    buf += (buf ? "\n\n" : "") + p;
  }
  flush();
  return out;
}

/** Markdown or plain text: sections follow headings, locators name the heading. */
export function extractText(text: string, markdown: boolean): Chunk[] {
  const body = markdown ? text.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/%%[\s\S]*?%%/g, "") : text;
  const sections: Array<{ title: string; paras: string[] }> = [{ title: "", paras: [] }];
  let cur = sections[0];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) cur.paras.push(para.join(" "));
    para = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const h = markdown ? /^#{1,6}\s+(.*)$/.exec(line) : null;
    if (h) {
      endPara();
      cur = { title: h[1].trim(), paras: [] };
      sections.push(cur);
    } else if (!line.trim()) endPara();
    else para.push(markdown ? line.replace(/^[>\-*+]\s+/, "").replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/[*_`]/g, "") : line.trim());
  }
  endPara();
  const out: Chunk[] = [];
  for (const s of sections) {
    const base = s.title || "start";
    const chunks = chunkParagraphs(s.paras, (n) => (n ? `${base} (${n + 1})` : base));
    out.push(...chunks.map((c, i) => (i === 0 ? c : { ...c, loc: `${base} (${i + 1})` })));
  }
  return out;
}

const BLOCK = /<\/?(?:p|div|br|li|tr|h[1-6]|blockquote|section|article|table|ul|ol|pre|hr)\b[^>]*>/gi;

/** HTML (saved web pages, ePub chapters) to paragraphs and a title. Scripts, styles and page furniture are dropped. */
export function htmlToParagraphs(html: string): { title: string; paras: string[] } {
  let h = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, "");
  const main = /<(article|main)\b[^>]*>([\s\S]*)<\/\1>/i.exec(h);
  if (main) h = main[2];
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h);
  const strip = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  const title = strip(h1?.[1] ?? t?.[1] ?? "");
  const text = decodeEntities(h.replace(BLOCK, "\n").replace(/<[^>]*>/g, ""));
  return { title, paras: text.split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean) };
}

export function extractHtml(html: string): Chunk[] {
  const { title, paras } = htmlToParagraphs(html);
  const base = title || "page";
  return chunkParagraphs(paras, (n) => (n ? `${base} (${n + 1})` : base));
}

/** CCEL ThML and TEI: sections from div titles or heads, then paragraphs. */
export function extractXmlText(xml: string): Chunk[] {
  const body = /<body\b[\s\S]*<\/body>/i.exec(xml)?.[0] ?? /<ThML\.body\b[\s\S]*<\/ThML\.body>/i.exec(xml)?.[0] ?? xml;
  const out: Chunk[] = [];
  const parts = body.split(/(?=<div\d?\b)/i);
  parts.forEach((part, i) => {
    const title = /<div\d?\b[^>]*\btitle="([^"]*)"/i.exec(part)?.[1] ?? /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(part)?.[1] ?? "";
    const paras = [...part.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decodeEntities(m[1].replace(/<note\b[\s\S]*?<\/note>/gi, "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()).filter(Boolean);
    const name = decodeEntities(title).replace(/<[^>]*>/g, "").trim() || `section ${i + 1}`;
    out.push(...chunkParagraphs(paras, (n) => (n ? `${name} (${n + 1})` : name)).map((c, n) => (n ? { ...c, loc: `${name} (${n + 1})` } : c)));
  });
  return out;
}

const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
const resolve = (base: string, href: string) => {
  const parts = (base + href.split("#")[0]).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
};

/** An ePub: the chapters in reading order, each with its title taken from the navigation or the page. */
export async function extractEpub(data: Uint8Array | ArrayBuffer): Promise<{ title: string; author: string; chunks: Chunk[] }> {
  const zip = await JSZip.loadAsync(data);
  const text = async (p: string) => (await zip.file(p)?.async("string")) ?? "";
  const container = await text("META-INF/container.xml");
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) throw new Error("This ePub has no package file.");
  const opf = await text(opfPath);
  const base = dirOf(opfPath);
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]*)"/.exec(m[0])?.[1];
    const href = /\bhref="([^"]*)"/.exec(m[0])?.[1];
    if (id && href) manifest.set(id, href);
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]*)"/g)].map((m) => manifest.get(m[1])).filter((x): x is string => !!x);
  const meta = (tag: string) => decodeEntities(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)</dc:${tag}>`, "i").exec(opf)?.[1]?.replace(/<[^>]*>/g, "") ?? "").trim();
  const chunks: Chunk[] = [];
  let n = 0;
  for (const href of spine) {
    const html = await text(resolve(base, decodeURI(href)));
    if (!html) continue;
    const { title, paras } = htmlToParagraphs(html);
    if (!paras.length) continue;
    n++;
    const name = title ? `${title}` : `part ${n}`;
    const cs = chunkParagraphs(paras, (i) => (i ? `${name} (${i + 1})` : name));
    chunks.push(...cs.map((c, i) => (i ? { ...c, loc: `${name} (${i + 1})` } : c)));
  }
  return { title: meta("title"), author: meta("creator"), chunks };
}

/** PDF pages (already extracted) to chunks that keep the page number. */
export function extractPages(pages: string[]): Chunk[] {
  const out: Chunk[] = [];
  pages.forEach((t, i) => {
    const paras = t.split(/\n{2,}|(?<=[.!?])\s{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    const cs = chunkParagraphs(paras.length ? paras : [t], () => `p. ${i + 1}`, i + 1);
    out.push(...cs);
  });
  return out;
}
