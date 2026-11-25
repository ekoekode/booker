/**
 * Manuscript document model and a small Markdown reader tuned for prose.
 * Pure: no Obsidian imports.
 */
import { cleanXml, stripComments, stripLinks } from "../text";
import { replaceCitations } from "../citations/cite";

export interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  /** this run is a footnote mark; the note's own text */
  note?: Run[];
  /** the number the note is printed with, set when an export is prepared (see notes.ts) */
  noteNo?: number;
  /** raised small text, such as a verse number */
  sup?: boolean;
}

export type Block =
  | { kind: "p"; runs: Run[] }
  | { kind: "quote"; runs: Run[] }
  | { kind: "h"; level: number; runs: Run[] }
  | { kind: "li"; runs: Run[]; ordered: boolean; n: number }
  | { kind: "date"; runs: Run[]; style: SceneDateStyle }
  | { kind: "rule" };

/** How the date printed at the top of a section looks. `size` is a percentage of the body text. */
export interface SceneDateStyle {
  align: "left" | "center" | "right";
  size: number;
  italic: boolean;
  bold: boolean;
}

export interface SceneDoc {
  title: string;
  blocks: Block[];
}
export interface ChapterDoc {
  title: string;
  /** back matter such as the bibliography: its title is printed without a chapter number */
  back?: boolean;
  /** the book's word for this level when it is not "Chapter" (a sermon, an entry) */
  word?: string;
  number: number;
  scenes: SceneDoc[];
}
export interface ActDoc {
  title: string;
  /** false when chapters sit directly under the book */
  titled: boolean;
  /** the book's word for its top level when it is not "Act" (printed as "Part" in the default case) */
  word?: string;
  number: number;
  chapters: ChapterDoc[];
}

export interface Manuscript {
  title: string;
  subtitle: string;
  author: string;
  surname: string;
  contact: string;
  language: string;
  words: number;
  dedication: string;
  copyright: string;
  about: string;
  coverPath: string | null;
  identifier: string;
  acts: ActDoc[];
}

export interface ParseOptions {
  /** a single newline starts a new paragraph (Obsidian's default look) */
  lineBreaksAreParagraphs: boolean;
  smartQuotes: boolean;
  /** turns [@key, locator] into note text; null when the key is not a known source */
  cite?: (key: string, loc?: string) => string | null;
  /** the citations are written in the text (APA, MLA) instead of becoming footnotes */
  citeInline?: boolean;
}

// ------------------------------------------------------------- inline

type Tok = { t: "text"; v: string } | { t: "mark"; kind: "b" | "i" | "s"; ch: string; paired?: boolean };

function isWordCh(c: string | undefined): boolean {
  return !!c && /[\p{L}\p{N}]/u.test(c);
}

export function parseInline(src: string): Run[] {
  return parseInlineRaw(src);
}

function parseInlineRaw(src: string): Run[] {
  src = cleanXml(src);
  const toks: Tok[] = [];
  let buf = "";
  const flush = () => {
    if (buf) toks.push({ t: "text", v: buf });
    buf = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!~=>|]/.test(src[i + 1])) {
      buf += src[i + 1];
      i++;
      continue;
    }
    if (c === "*" || c === "_") {
      if (c === "_" && (isWordCh(src[i - 1]) && isWordCh(src[i + 1]))) {
        buf += c; // snake_case
        continue;
      }
      let j = i;
      while (src[j] === c) j++;
      const n = j - i;
      flush();
      // ***x*** = bold+italic, **x** = bold, *x* = italic
      let left = n;
      while (left >= 2) {
        toks.push({ t: "mark", kind: "b", ch: c });
        left -= 2;
      }
      if (left === 1) toks.push({ t: "mark", kind: "i", ch: c });
      i = j - 1;
      continue;
    }
    if (c === "~" && src[i + 1] === "~") {
      flush();
      toks.push({ t: "mark", kind: "s", ch: "~" });
      i++;
      continue;
    }
    if (c === "=" && src[i + 1] === "=") {
      i++; // highlight: keep text only
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        buf += src.slice(i + 1, end);
        i = end;
        continue;
      }
    }
    buf += c;
  }
  flush();

  // pair markers: a marker closes the latest open marker of the same kind
  const open: Record<string, number[]> = { b: [], i: [], s: [] };
  toks.forEach((tk, idx) => {
    if (tk.t !== "mark") return;
    const stack = open[tk.kind];
    if (stack.length) {
      const o = stack.pop()!;
      (toks[o] as any).paired = true;
      tk.paired = true;
      (tk as any).closes = o;
    } else stack.push(idx);
  });

  const runs: Run[] = [];
  const state = { b: false, i: false, s: false };
  for (const tk of toks) {
    if (tk.t === "text") {
      if (tk.v) runs.push({ text: tk.v, ...(state.b && { b: true }), ...(state.i && { i: true }), ...(state.s && { s: true }) });
    } else if (tk.paired) {
      state[tk.kind] = !state[tk.kind];
    } else {
      runs.push({ text: tk.ch.repeat(tk.kind === "b" ? 2 : 1), ...(state.b && { b: true }), ...(state.i && { i: true }) });
    }
  }
  // merge neighbours with equal formatting
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && !!last.b === !!r.b && !!last.i === !!r.i && !!last.s === !!r.s) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * [@key, locator] becomes a note: inside a footnote's own text it is replaced by the citation, anywhere else it turns
 * into an inline note. Unknown keys are left as they are.
 */
export function expandCitations(text: string, cite: (key: string, loc?: string) => string | null, inline = false): string {
  return text
    .split("\n")
    .map((line) => {
      const inDef = /^\[\^[^\]\[\n]{1,200}\]:/.test(line);
      return replaceCitations(line, (key, loc) => {
        const note = cite(key, loc);
        if (note === null) return null;
        const flat = note.replace(/[\[\]]/g, "");
        return inline ? note : inDef ? flat : `^[${flat}]`;
      });
    })
    .join("\n");
}

// ----------------------------------------------------------- footnotes

const NOTE_OPEN = "\uE000";
const NOTE_CLOSE = "\uE001";
const NOTE_MARK = /\uE000(\d+)\uE001|\uE002([^\uE003]*)\uE003/g;

/**
 * Footnotes in the Obsidian style: [^label] in the text with [^label]: the note somewhere in the same file, and
 * ^[the note written right here]. Each mark in the text becomes a placeholder that expandNotes turns into a run;
 * a mark with no matching note, and a note nobody refers to, are dropped.
 */
export function extractNotes(text: string): { text: string; bodies: string[] } {
  const defs = new Map<string, string>();
  const kept: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\[\^([^\]\[\n]{1,200})\]:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) {
      kept.push(lines[i]);
      continue;
    }
    let body = m[2];
    while (i + 1 < lines.length && /^(?: {2,}|\t)\S/.test(lines[i + 1])) body += " " + lines[++i].trim();
    if (!defs.has(m[1])) defs.set(m[1], body.trim());
  }
  const bodies: string[] = [];
  const mark = (body: string) => {
    bodies.push(body);
    return `${NOTE_OPEN}${bodies.length - 1}${NOTE_CLOSE}`;
  };
  let out = kept.join("\n").replace(/\[\^([^\]\[\n]{1,200})\]/g, (_, label: string) => (defs.get(label) ? mark(defs.get(label)!) : ""));
  out = out.replace(/\^\[([^\[\]\n]{1,2000})\]/g, (_, body: string) => mark(body.trim()));
  return { text: out, bodies };
}

/** Split runs at the placeholders left by extractNotes into note runs. */
export function expandNotes(runs: Run[], bodies: string[], parse: (body: string) => Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text.includes(NOTE_OPEN) && !r.text.includes("\uE002")) {
      out.push(r);
      continue;
    }
    let last = 0;
    for (const m of r.text.matchAll(NOTE_MARK)) {
      if (m.index! > last) out.push({ ...r, text: r.text.slice(last, m.index) });
      if (m[2] !== undefined) out.push({ ...r, text: m[2], sup: true });
      else {
        const body = bodies[Number(m[1])];
        if (body) out.push({ text: "", note: parse(body) });
      }
      last = m.index! + m[0].length;
    }
    if (last < r.text.length) out.push({ ...r, text: r.text.slice(last) });
  }
  return out;
}

// -------------------------------------------------------- smart quotes

const OPENERS = /[\s(\[{—–\-‘“ ]/;

export function smarten(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '"' && c !== "'") {
      out += c;
      continue;
    }
    // look back past emphasis markers
    let k = i - 1;
    while (k >= 0 && /[*_~]/.test(text[k])) k--;
    const prev = k >= 0 ? text[k] : "";
    const next = text[i + 1];
    const atStart = prev === "";
    const opening = atStart || OPENERS.test(prev);
    if (c === '"') {
      out += opening ? "“" : "”";
    } else {
      // apostrophe vs single quote
      if (isWordCh(prev) && isWordCh(next)) out += "’"; // don't
      else if (opening && next && !/\s/.test(next)) {
        // 'tis, 'em, '90s are apostrophes; otherwise an opening quote
        out += /^(tis|twas|em|cause|til|round|n)\b/i.test(text.slice(i + 1, i + 7)) || /^\d\d/.test(text.slice(i + 1, i + 3)) ? "’" : "‘";
      } else out += "’";
    }
  }
  return out
    .replace(/---/g, "—")
    .replace(/--/g, "—")
    .replace(/\.\.\./g, "…");
}

// ------------------------------------------------------------- blocks

export function parseMarkdown(md: string, opts: ParseOptions): Block[] {
  let text = stripComments(cleanXml(md));
  text = stripLinks(text);
  if (opts.cite) text = expandCitations(text, opts.cite, opts.citeInline);
  text = text.replace(/<sup>([^<>\n]{1,12})<\/sup>/gi, "\uE002$1\uE003"); // raised text, such as a verse number
  // tag bodies exclude "<" and are length-bounded so a run of "<span " stays linear
  text = text.replace(/<br\s{0,20}\/?>/gi, "\n").replace(/<\/?(?:span|div|p|center|u|mark|small|sup|sub)[^<>]{0,500}>/gi, "");
  text = text.replace(/\r\n?/g, "\n");
  const notes = extractNotes(text);
  text = notes.text;

  const lines = text.split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];

  const prep = (s: string) => (opts.smartQuotes ? smarten(s) : s);
  const parseInline = (s: string) => expandNotes(parseInlineRaw(s), notes.bodies, (b) => parseInlineRaw(prep(b)));
  const pushPara = () => {
    if (!para.length) return;
    if (opts.lineBreaksAreParagraphs) {
      for (const l of para) if (l.trim()) blocks.push({ kind: "p", runs: parseInline(prep(l.trim())) });
    } else blocks.push({ kind: "p", runs: parseInline(prep(para.join(" ").replace(/\s+/g, " ").trim())) });
    para = [];
  };
  const pushQuote = () => {
    if (!quote.length) return;
    // an Obsidian callout (> [!summary] Title) prints as a quote led by its title; an epigraph or quote callout has none
    const head = /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(quote[0].trim());
    if (head) quote = quote.slice(1);
    const body = parseInline(prep(quote.join(" ").replace(/\s+/g, " ").trim()));
    const kind = head?.[1].toLowerCase();
    const label = head && kind !== "epigraph" && kind !== "quote" ? head[2].trim() || head[1].charAt(0).toUpperCase() + head[1].slice(1).toLowerCase().replace(/-/g, " ") : "";
    blocks.push({ kind: "quote", runs: label ? [{ text: `${label}. `, b: true }, ...body] : kind === "epigraph" ? body.map((r) => ({ ...r, i: true })) : body });
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      pushPara();
      pushQuote();
      continue;
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      pushPara();
      pushQuote();
      blocks.push({ kind: "rule" });
      continue;
    }
    let m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      pushPara();
      pushQuote();
      blocks.push({ kind: "h", level: m[1].length, runs: parseInline(prep(m[2])) });
      continue;
    }
    m = /^>\s?(.*)$/.exec(line);
    if (m) {
      pushPara();
      quote.push(m[1]);
      continue;
    }
    pushQuote();
    m = /^\s*(?:([-+*])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (m && !/^\s*\*\*/.test(line)) {
      pushPara();
      blocks.push({ kind: "li", runs: parseInline(prep(m[3])), ordered: !!m[2], n: m[2] ? parseInt(m[2], 10) : 0 });
      continue;
    }
    para.push(line);
  }
  pushPara();
  pushQuote();
  return blocks;
}

/** A copy of the manuscript with every string made safe for XML-based output (ePub, Word, PDF). */
export function cleanManuscript(m: Manuscript): Manuscript {
  const runs = (rs: Run[]): Run[] => rs.map((r) => ({ ...r, text: cleanXml(r.text), ...(r.note && { note: runs(r.note) }) }));
  const block = (b: Block): Block => (b.kind === "rule" ? b : { ...b, runs: runs(b.runs) });
  return {
    ...m,
    title: cleanXml(m.title),
    subtitle: cleanXml(m.subtitle),
    author: cleanXml(m.author),
    surname: cleanXml(m.surname),
    contact: cleanXml(m.contact),
    language: cleanXml(m.language),
    dedication: cleanXml(m.dedication),
    copyright: cleanXml(m.copyright),
    about: cleanXml(m.about),
    identifier: cleanXml(m.identifier),
    acts: m.acts.map((a) => ({
      ...a,
      title: cleanXml(a.title),
      chapters: a.chapters.map((c) => ({
        ...c,
        title: cleanXml(c.title),
        scenes: c.scenes.map((s) => ({ ...s, title: cleanXml(s.title), blocks: s.blocks.map(block) })),
      })),
    })),
  };
}

export function plainText(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

export function roundedWords(n: number): number {
  if (n < 1000) return Math.max(100, Math.round(n / 100) * 100);
  if (n < 100000) return Math.round(n / 500) * 500;
  return Math.round(n / 1000) * 1000;
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "book"
  );
}

export function countManuscriptWords(m: Manuscript): number {
  let n = 0;
  for (const a of m.acts) for (const c of a.chapters) for (const s of c.scenes) for (const b of s.blocks) if (b.kind !== "rule") n += plainText(b.runs).split(/\s+/).filter(Boolean).length;
  return n;
}
