import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { actHeading, chapterHeading, ExportOptions } from "./headings";
import { cleanXml } from "../text";
import { Block, cleanManuscript, Manuscript, Run, roundedWords } from "./model";
import { FONTS, HEBREW_FONT } from "./fonts";
import { hasHebrew, scriptSegments, visualHebrew } from "./script";
import { breakLines } from "./linebreak";
import { resolveLayout } from "./layout";
import { bookNotes, chapterNotes, hasNotes, numberNotes } from "./notes";
import { dropLetter, isFontStyle, resolveOpening } from "../writing/initials";
import { ILLUMINATED, OPENING_FONT_FILES } from "../writing/initialsData";

const PT = 72;

interface FontSet {
  regular: PDFFont;
  italic: PDFFont;
  bold: PDFFont;
  boldItalic: PDFFont;
  /** standard fonts only know WinAnsi */
  winAnsi: boolean;
}

interface Atom {
  text: string;
  font: PDFFont;
  width: number;
  /** whitespace before this atom (a break is allowed here) */
  space: boolean;
  /** a footnote number: printed small and raised */
  sup?: boolean;
  /** Hebrew, already in drawing order (right to left letters reversed) */
  he?: boolean;
  /** the text of the footnote this number points to, when notes are printed at the foot of the page */
  note?: Run[];
  noteNo?: number;
}

/** One printed line of a footnote at the foot of a page. */
interface FootLine {
  atoms: Atom[];
  a: number;
  b: number;
}

const SUP = 0.62;

interface Layout {
  pageW: number;
  pageH: number;
  top: number;
  bottom: number;
  inner: number;
  outer: number;
  size: number;
  leading: number;
  indent: number;
  justify: boolean;
  manuscript: boolean;
  mirror: boolean;
}

interface PageInfo {
  page: PDFPage;
  kind: "front" | "body" | "opener" | "blank";
  number: number | null;
  /** footnote lines printed at the foot of this page */
  foot: FootLine[];
  /** lines of body text already on the page */
  bodyLines: number;
}

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));
function winSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (ch === "‑" || ch === "‐") out += "-";
    else if (ch === "•" || ch === "●") out += "•";
    else if (ch === "…") out += "…";
    else out += "?";
  }
  return out;
}

export async function buildPdf(m0: Manuscript, opts: ExportOptions, breakMark0: string): Promise<ArrayBuffer> {
  const notesAtBookEnd = opts.notePlacement === "book";
  // notes at the foot of the page are the default; a chapter's list or the book's list are the other two choices
  const notesBottom = !opts.notePlacement || opts.notePlacement === "bottom";
  const m = numberNotes(cleanManuscript(m0), opts.noteNumbering ?? "chapter");
  const breakMark = cleanXml(breakMark0);
  const manuscript = opts.preset === "manuscript";
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(m.title);
  doc.setAuthor(m.author);
  doc.setProducer("Booker");
  doc.setCreator("Booker");

  const rl = resolveLayout(opts);
  const std = (r: StandardFonts, i: StandardFonts, b: StandardFonts, bi: StandardFonts) => async (): Promise<FontSet> => ({
    regular: await doc.embedFont(r),
    italic: await doc.embedFont(i),
    bold: await doc.embedFont(b),
    boldItalic: await doc.embedFont(bi),
    winAnsi: true,
  });
  const faces: Record<string, () => Promise<FontSet>> = {
    courier: std(StandardFonts.Courier, StandardFonts.CourierOblique, StandardFonts.CourierBold, StandardFonts.CourierBoldOblique),
    times: std(StandardFonts.TimesRoman, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanBoldItalic),
    helvetica: std(StandardFonts.Helvetica, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBold, StandardFonts.HelveticaBoldOblique),
    embedded: async () => ({
      regular: await doc.embedFont(FONTS.regular, { subset: true }),
      italic: await doc.embedFont(FONTS.italic, { subset: true }),
      bold: await doc.embedFont(FONTS.bold, { subset: true }),
      boldItalic: await doc.embedFont(FONTS.boldItalic, { subset: true }),
      winAnsi: false,
    }),
  };
  const fonts: FontSet = await faces[rl.pdfFace]();
  let hebrewFont: PDFFont | null = null;
  const needsHebrew = m.acts.some((a) => a.chapters.some((c) => c.scenes.some((sc) => sc.blocks.some((b) => b.kind !== "rule" && b.runs.some((r) => hasHebrew(r.text) || (r.note?.some((n) => hasHebrew(n.text))))))));
  if (needsHebrew) hebrewFont = await doc.embedFont(HEBREW_FONT, { subset: true });

  // the large first letter of each chapter: the chosen font, or the illuminated artwork (when the assets are real bytes)
  const opening = resolveOpening(opts.opening);
  let openFont: PDFFont | null = null;
  const openArt = new Map<string, PDFImage>();
  if (isFontStyle(opening.style)) {
    const bytes = OPENING_FONT_FILES[opening.style].data as unknown;
    if (bytes instanceof Uint8Array) openFont = await doc.embedFont(bytes, { subset: true });
  } else if (opening.style === "art") {
    const letters = new Set<string>();
    for (const act of m.acts) for (const ch of act.chapters) {
      const first = ch.scenes[0]?.blocks.find((b) => b.kind === "p");
      const l = first && first.kind === "p" ? dropLetter(first.runs[0]?.text ?? "")?.ch : undefined;
      if (l) letters.add(l);
    }
    for (const l of letters) {
      const bytes = ILLUMINATED[l] as unknown;
      if (bytes instanceof Uint8Array) openArt.set(l, await doc.embedPng(bytes));
    }
  }

  const lay: Layout = {
    pageW: rl.pageW * PT,
    pageH: rl.pageH * PT,
    top: rl.top * PT,
    bottom: rl.bottom * PT,
    inner: rl.inner * PT,
    outer: rl.outer * PT,
    size: rl.fontSize,
    leading: rl.fontSize * rl.line,
    indent: rl.indent * PT,
    justify: rl.justify,
    manuscript,
    mirror: rl.mirror,
  };

  const pages: PageInfo[] = [];
  let cur: PageInfo | null = null as PageInfo | null;
  let y = 0;

  const safe = (s: string) => (fonts.winAnsi ? winSafe(s) : s);
  const widthCache = new Map<PDFFont, Map<string, number>>();
  const widthOf = (font: PDFFont, text: string, size: number): number => {
    let c = widthCache.get(font);
    if (!c) widthCache.set(font, (c = new Map()));
    const key = `${size}|${text}`;
    let w = c.get(key);
    if (w === undefined) {
      try {
        w = font.widthOfTextAtSize(text, size);
      } catch {
        w = font.widthOfTextAtSize(text.replace(/[^\x20-\x7e]/g, "?"), size);
      }
      c.set(key, w);
    }
    return w;
  };

  const newPage = (kind: PageInfo["kind"]): PageInfo => {
    const page = doc.addPage([lay.pageW, lay.pageH]);
    cur = { page, kind, number: null, foot: [], bodyLines: 0 };
    pages.push(cur);
    y = lay.pageH - lay.top;
    // notes that did not fit under their text carry on at the foot of this page
    while (carry.length && reserve(cur.foot.length + 1) <= maxReserve()) cur.foot.push(carry.shift()!);
    return cur;
  };
  const isRecto = (index: number) => index % 2 === 0; // page 1 (index 0) is recto
  const leftMargin = (index: number) => (!lay.mirror || isRecto(index) ? lay.inner : lay.outer);
  const textWidth = () => lay.pageW - lay.inner - lay.outer;
  const baseBottom = () => lay.bottom + (lay.manuscript ? 0 : 6);
  const footSize = lay.size * 0.82;
  const footLead = lay.leading * 0.84;
  const SEP = 12;
  const reserve = (n: number) => (n > 0 ? SEP + n * footLead : 0);
  /** a page gives notes at most this much room, so the text always has some */
  const maxReserve = () => (lay.pageH - lay.top - baseBottom()) * 0.45;
  let carry: FootLine[] = [];
  const bottomLimit = () => baseBottom() + reserve(cur?.foot.length ?? 0);

  const fontFor = (r: Run): PDFFont => (r.b && r.i ? fonts.boldItalic : r.b ? fonts.bold : r.i ? fonts.italic : fonts.regular);

  const toAtoms = (runs: Run[], size: number, forceFont?: PDFFont): Atom[] => {
    const atoms: Atom[] = [];
    let pendingSpace = false;
    for (const r of runs) {
      const font = forceFont ?? fontFor(r);
      if (r.note) {
        const t = String(r.noteNo);
        atoms.push({ text: t, font: fonts.regular, width: widthOf(fonts.regular, t, size * SUP), space: false, sup: true, note: r.note, noteNo: r.noteNo });
        pendingSpace = false;
        continue;
      }
      if (hebrewFont && hasHebrew(r.text)) {
        for (const seg of scriptSegments(r.text)) {
          if (!seg.he) {
            pushWords(safe(seg.t), font, r);
            continue;
          }
          // one atom per word, each reversed letter by letter; drawLine puts the words of a run in right-to-left order
          const words = seg.t.split(/(\s+)/);
          for (const w of words) {
            if (w === "") continue;
            if (/^\s+$/.test(w)) {
              pendingSpace = true;
              continue;
            }
            const vis = visualHebrew(w);
            atoms.push({ text: vis, font: hebrewFont, width: widthOf(hebrewFont, vis, size), space: pendingSpace && atoms.length > 0, he: true });
            pendingSpace = false;
          }
        }
        continue;
      }
      pushWords(safe(r.text), font, r);
      continue;
    }
    return atoms;
    function pushWords(text: string, font: PDFFont, r: Run) {
      const parts = text.split(/(\s+)/);
      for (const p of parts) {
        if (p === "") continue;
        if (/^\s+$/.test(p)) {
          pendingSpace = true;
          continue;
        }
        atoms.push({ text: p, font, width: widthOf(font, p, r.sup ? size * SUP : size), space: pendingSpace && atoms.length > 0, ...(r.sup && { sup: true }) });
        pendingSpace = false;
      }
    }
  };

  /** Split atoms wider than a line, then break the paragraph into lines. */
  const breakAtoms = (atoms: Atom[], first: number, rest: number, size: number): [number, number][] => {
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      if (a.width <= rest) continue;
      let chunk = "";
      const pieces: Atom[] = [];
      for (const ch of a.text) {
        if (widthOf(a.font, chunk + ch, size) > rest * 0.95 && chunk) {
          pieces.push({ text: chunk, font: a.font, width: widthOf(a.font, chunk, size), space: false });
          chunk = "";
        }
        chunk += ch;
      }
      pieces.push({ text: chunk, font: a.font, width: widthOf(a.font, chunk, size), space: false });
      pieces[0].space = a.space;
      atoms.splice(i, 1, ...pieces);
      i += pieces.length - 1;
    }
    return breakLines(atoms, first, rest, widthOf(fonts.regular, " ", size));
  };

  const drawLine = (page: PDFPage, atoms: Atom[], from: number, to: number, x: number, yy: number, size: number, avail: number, justify: boolean) => {
    const sp = widthOf(fonts.regular, " ", size);
    // Hebrew words run right to left: a stretch of them is drawn in reverse order, with the gaps between them kept
    const items: Array<{ a: Atom; gap: boolean }> = [];
    for (let k = from; k < to; ) {
      if (!atoms[k].he) {
        items.push({ a: atoms[k], gap: k > from && atoms[k].space });
        k++;
        continue;
      }
      let e = k;
      while (e < to && atoms[e].he) e++;
      for (let i = e - 1; i >= k; i--) items.push({ a: atoms[i], gap: i === e - 1 ? k > from && atoms[k].space : atoms[i + 1].space });
      k = e;
    }
    let gaps = 0;
    let sum = 0;
    for (const it of items) {
      sum += it.a.width;
      if (it.gap) gaps++;
    }
    let gapW = sp;
    if (justify && gaps > 0) gapW = (avail - sum) / gaps;
    else if (items.length && items.every((i) => i.a.he)) x += Math.max(0, avail - (sum + gaps * sp));
    let cx = x;
    for (const it of items) {
      if (it.gap) cx += gapW;
      const a = it.a;
      page.drawText(a.text, { x: cx, y: a.sup ? yy + size * 0.38 : yy, size: a.sup ? size * SUP : size, font: a.font, color: rgb(0, 0, 0) });
      cx += a.width;
    }
  };

  const noteCache = new WeakMap<Atom, FootLine[]>();
  const noteLines = (a: Atom): FootLine[] => {
    let l = noteCache.get(a);
    if (!l) {
      const atoms = toAtoms([{ text: `${a.noteNo}. ` }, ...(a.note ?? [])], footSize);
      l = breakAtoms(atoms, textWidth(), textWidth(), footSize).map(([x, z]) => ({ atoms, a: x, b: z }));
      noteCache.set(a, l);
    }
    return l;
  };

  /** Put the notes of a line of text at the foot of the current page. False when they do not fit with the line (it moves to the next page). */
  const placeNotes = (marks: Atom[]): boolean => {
    const pg = cur!;
    const lines = marks.flatMap(noteLines);
    if (!lines.length) return true;
    const fits = (n: number) => y - lay.leading >= baseBottom() + reserve(n) && reserve(n) <= maxReserve();
    const f0 = pg.foot.length;
    if (fits(f0 + lines.length)) {
      pg.foot.push(...lines);
      return true;
    }
    // a page with no text yet takes what fits and the rest of the note carries on to the next page
    if (pg.bodyLines > 0) return false;
    let k = 0;
    while (k < lines.length && fits(f0 + k + 1)) k++;
    if (k === 0 && f0 > 0) return false;
    k = Math.max(1, k);
    pg.foot.push(...lines.slice(0, k));
    carry.push(...lines.slice(k));
    return true;
  };

  const ensure = (needed: number) => {
    if (!cur || y - needed < bottomLimit()) newPage("body");
  };

  interface ParaOpts {
    indent?: boolean;
    left?: number;
    right?: number;
    size?: number;
    leading?: number;
    align?: "left" | "justify" | "center" | "right";
    before?: number;
    after?: number;
    font?: PDFFont;
    keepNext?: boolean;
    /** a large first letter that this many lines of the paragraph wrap around */
    drop?: boolean;
  }

  interface Cap {
    ch: string;
    lines: number;
    boxW: number;
    boxH: number;
    /** the space between the letter and the text, and so how far the first lines move in */
    shift: number;
    runs: Run[];
  }

  /** The letter taken off the front of a paragraph, and the room it needs. Null when the paragraph cannot have one. */
  const makeCap = (runs: Run[], size: number, leading: number): Cap | null => {
    if (opening.style === "off") return null;
    const first = runs[0];
    const dl = first && !first.note && !first.sup ? dropLetter(first.text) : null;
    if (!dl) return null;
    const lines = opening.lines;
    const boxH = (lines - 1) * leading + size * 0.7 + size * 0.14;
    let boxW: number;
    if (opening.style === "art") {
      const img = openArt.get(dl.ch);
      if (!img) return null;
      boxW = (boxH * img.width) / img.height;
    } else {
      if (!openFont) return null;
      const fs = boxH * (opening.frame === "none" ? 0.9 : 0.74);
      boxW = opening.frame === "none" ? widthOf(openFont, dl.ch, fs) + size * 0.1 : Math.max(boxH * 0.78, widthOf(openFont, dl.ch, fs) + boxH * 0.3);
    }
    return { ch: dl.ch, lines, boxW, boxH, shift: boxW + size * (opening.style === "art" ? 0.28 : 0.4), runs: [{ ...first, text: dl.rest }, ...runs.slice(1)] };
  };

  const drawCap = (page: PDFPage, cap: Cap, x: number, top: number, size: number) => {
    const bottom = top - cap.boxH;
    if (opening.style === "art") {
      page.drawImage(openArt.get(cap.ch)!, { x, y: bottom, width: cap.boxW, height: cap.boxH });
      return;
    }
    const f = openFont!;
    const ink = rgb(0, 0, 0);
    const paper = rgb(1, 1, 1);
    const fs = cap.boxH * (opening.frame === "none" ? 0.9 : 0.74);
    const framed = opening.frame !== "none";
    if (opening.frame === "block") page.drawRectangle({ x, y: bottom, width: cap.boxW, height: cap.boxH, color: ink });
    else if (opening.frame === "single") page.drawRectangle({ x, y: bottom, width: cap.boxW, height: cap.boxH, borderColor: ink, borderWidth: 1 });
    else if (opening.frame === "double") {
      page.drawRectangle({ x, y: bottom, width: cap.boxW, height: cap.boxH, borderColor: ink, borderWidth: 1.4 });
      page.drawRectangle({ x: x + 3.2, y: bottom + 3.2, width: cap.boxW - 6.4, height: cap.boxH - 6.4, borderColor: ink, borderWidth: 0.5 });
    }
    const w = widthOf(f, cap.ch, fs);
    const baseline = framed ? bottom + (cap.boxH - fs * 0.7) / 2 : bottom + size * 0.12 * 0.5;
    page.drawText(cap.ch, { x: x + (cap.boxW - w) / 2, y: baseline, size: fs, font: f, color: opening.frame === "block" ? paper : ink });
  };

  const addParagraph = (runs: Run[], o: ParaOpts = {}) => {
    const size = o.size ?? lay.size;
    const leading = o.leading ?? lay.leading;
    if (!cur) newPage("body");
    if (o.before) y -= o.before;
    const idx = pages.length - 1;
    const left0 = leftMargin(idx) + (o.left ?? 0);
    const width = textWidth() - (o.left ?? 0) - (o.right ?? 0);
    const cap = o.drop ? makeCap(runs, size, leading) : null;
    const atoms = toAtoms(cap ? cap.runs : runs, size, o.font);
    if (!atoms.length) return;
    const ind = cap ? 0 : o.indent ? lay.indent : 0;
    const shift = cap?.shift ?? 0;
    let lines: Array<[number, number]>;
    if (cap) {
      // the first lines are narrower by the letter's width; the rest run the full width, so the text wraps underneath it
      const first = breakAtoms(atoms, width - shift, width - shift, size).slice(0, cap.lines);
      const from = first.length ? first[first.length - 1][1] : 0;
      const tail = atoms.splice(from);
      const rest = breakAtoms(tail, width, width, size);
      atoms.push(...tail);
      lines = [...first, ...rest.map(([a, b]): [number, number] => [a + from, b + from])];
    } else lines = breakAtoms(atoms, width - ind, width, size);
    let li = 0;
    while (li < lines.length) {
      const remaining = lines.length - li;
      let fit = Math.floor((y - bottomLimit()) / leading);
      if (fit < 1) {
        newPage("body");
        continue;
      }
      // a large first letter and the lines beside it stay on one page
      if (cap && li === 0 && fit < Math.min(cap.lines, remaining)) {
        newPage("body");
        continue;
      }
      let take = Math.min(fit, remaining);
      if (take < remaining) {
        // widow / orphan control
        if (remaining - take === 1) take -= 1;
        if (take < 2 && remaining >= 2 && li === 0) take = 0;
      }
      if (take <= 0) {
        newPage("body");
        continue;
      }
      const pg = pages[pages.length - 1];
      const pidx = pages.length - 1;
      const x0 = leftMargin(pidx) + (o.left ?? 0);
      for (let t = 0; t < take; t++, li++) {
        const [a, b] = lines[li];
        if (notesBottom) {
          // the line must clear the notes already on the page and its own
          if (y - leading < bottomLimit() - 0.01) break;
          const marks = atoms.slice(a, b).filter((x) => x.note);
          if (marks.length && !placeNotes(marks)) break;
          pg.bodyLines++;
        }
        const isFirst = li === 0;
        const isLast = li === lines.length - 1;
        const beside = !!cap && li < cap.lines;
        const avail = beside ? width - shift : isFirst ? width - ind : width;
        let x = x0 + (beside ? shift : isFirst ? ind : 0);
        y -= leading;
        if (cap && isFirst) drawCap(pg.page, cap, x0, y + size * 0.7, size);
        const align = o.align ?? (lay.justify ? "justify" : "left");
        if (align === "center") {
          let sum = 0;
          for (let k = a; k < b; k++) sum += atoms[k].width + (k > a && atoms[k].space ? widthOf(fonts.regular, " ", size) : 0);
          x = x0 + (width - sum) / 2;
          drawLine(pg.page, atoms, a, b, x, y, size, avail, false);
        } else if (align === "right") {
          let sum = 0;
          for (let k = a; k < b; k++) sum += atoms[k].width + (k > a && atoms[k].space ? widthOf(fonts.regular, " ", size) : 0);
          x = x0 + width - sum;
          drawLine(pg.page, atoms, a, b, x, y, size, avail, false);
        } else drawLine(pg.page, atoms, a, b, x, y, size, avail, align === "justify" && !isLast);
      }
      void left0;
      if (li < lines.length) newPage("body");
    }
    // a paragraph shorter than the letter leaves room for the rest of it
    if (cap && lines.length < cap.lines) y -= (cap.lines - lines.length) * leading;
    const gap = o.after ?? (o.size === undefined ? rl.paraAfter : 0);
    if (gap) y -= gap;
  };

  const centered = (text: string, o: { size: number; font: PDFFont; before?: number; after?: number; spacing?: number; page?: PDFPage }) => {
    if (!cur) newPage("body");
    const pg = o.page ?? pages[pages.length - 1].page;
    if (o.before) y -= o.before;
    const s = safe(text);
    const idx = pages.length - 1;
    const x0 = leftMargin(idx);
    const tw = textWidth();
    let w: number;
    if (o.spacing) {
      w = [...s].reduce((n, ch) => n + widthOf(o.font, ch, o.size) + o.spacing!, 0) - o.spacing;
      let x = x0 + (tw - w) / 2;
      y -= o.size * 1.2;
      for (const ch of s) {
        pg.drawText(ch, { x, y, size: o.size, font: o.font });
        x += widthOf(o.font, ch, o.size) + o.spacing;
      }
    } else {
      w = widthOf(o.font, s, o.size);
      y -= o.size * 1.2;
      pg.drawText(s, { x: x0 + (tw - w) / 2, y, size: o.size, font: o.font });
    }
    if (o.after) y -= o.after;
  };

  // ------------------------------------------------------------- front matter
  if (!rl.titlePage) {
    // no title, copyright or dedication pages: the book starts at the first chapter
  } else if (manuscript) {
    newPage("front");
    const contact = m.contact.split(/\r?\n/).filter(Boolean);
    const pg = pages[0].page;
    const words = `About ${roundedWords(m.words).toLocaleString("en-US")} words`;
    const lines = contact.length ? contact : [m.author];
    lines.forEach((l, i) => {
      pg.drawText(safe(l), { x: lay.inner, y: lay.pageH - lay.top - 12 - i * 14, size: 12, font: fonts.regular });
    });
    const ww = widthOf(fonts.regular, safe(words), 12);
    pg.drawText(safe(words), { x: lay.pageW - lay.outer - ww, y: lay.pageH - lay.top - 12, size: 12, font: fonts.regular });
    y = lay.pageH * 0.52;
    centered(m.title.toUpperCase(), { size: 12, font: fonts.regular });
    if (m.subtitle) centered(m.subtitle, { size: 12, font: fonts.italic, before: 6 });
    if (m.author.trim()) centered(`by ${m.author}`, { size: 12, font: fonts.regular, before: 14 });
  } else {
    if (m.title) {
      newPage("front"); // half title
      y = lay.pageH * 0.6;
      centered(m.title, { size: 16, font: fonts.regular });
      newPage("front"); // title page
      y = lay.pageH * 0.68;
      centered(m.title, { size: 26, font: fonts.bold, after: 6 });
      if (m.subtitle) centered(m.subtitle, { size: 13, font: fonts.italic, before: 4 });
      y = lay.pageH * 0.3;
      centered(m.author, { size: 14, font: fonts.regular, spacing: 1.5 });
    }
    if (m.copyright) {
      newPage("front");
      y = lay.bottom + 120;
      for (const l of m.copyright.split(/\n+/)) addParagraph([{ text: l }], { size: 8.5, leading: 11.5, align: "left" });
    }
    if (m.dedication) {
      newPage("front");
      y = lay.pageH * 0.62;
      centered(m.dedication, { size: 11, font: fonts.italic });
    }
  }

  // ---------------------------------------------------------------- body
  const renderBlocks = (blocks: Block[], afterBreak: boolean) => {
    let firstPara = true;
    for (const b of blocks) {
      switch (b.kind) {
        case "p":
          addParagraph(b.runs, { indent: !(firstPara && afterBreak) && !(firstPara && opener), drop: dropPending });
          firstPara = false;
          opener = false;
          dropPending = false;
          break;
        case "quote":
          addParagraph(b.runs, { left: lay.manuscript ? 36 : 18, right: lay.manuscript ? 36 : 18, font: undefined, before: 2, after: 2 });
          firstPara = false;
          break;
        case "date":
          addParagraph(b.runs.map((r) => ({ ...r, i: b.style.italic || r.i, b: b.style.bold || r.b })), { align: b.style.align, size: (lay.size * b.style.size) / 100, leading: Math.max(lay.leading, (lay.leading * b.style.size) / 100), before: lay.leading * 0.3, after: lay.leading * 0.4, keepNext: true });
          break;
        case "h":
          addParagraph(b.runs.map((r) => ({ ...r, b: true })), { align: "center", before: lay.leading * 0.6, after: lay.leading * 0.4 });
          break;
        case "li":
          addParagraph([{ text: b.ordered ? `${b.n}.  ` : "•  " }, ...b.runs], { left: 14 });
          break;
        case "rule":
          sceneBreak();
          firstPara = true;
          afterBreak = true;
          break;
      }
    }
  };
  let opener = false;
  let dropPending = false;

  const sceneBreak = () => {
    ensure(lay.leading * 3);
    if (lay.manuscript) {
      centered("#", { size: lay.size, font: fonts.regular, before: lay.leading * 0.4 });
      y -= lay.leading * 0.4;
    } else {
      centered(breakMark, { size: lay.size, font: fonts.regular, before: lay.leading * 0.7, after: lay.leading * 0.5, spacing: breakMark.length > 1 ? 1 : 0 });
    }
  };

  let bodyStarted = false;
  for (const act of m.acts) {
    if (act.titled && opts.actTitles) {
      if (rl.breakBeforeAct) {
        newPage("opener");
        y = lay.pageH * (lay.manuscript ? 0.55 : 0.58);
      } else {
        ensure(lay.leading * 6);
        y -= lay.leading * 2;
      }
      bodyStarted = true;
      centered(actHeading(act), { size: lay.manuscript ? 12 : 20, font: lay.manuscript ? fonts.regular : fonts.bold, spacing: lay.manuscript ? 0 : 1 });
    }
    for (const ch of act.chapters) {
      const h = chapterHeading(ch, opts.chapterStyle);
      if (rl.breakBeforeChapter || !cur) {
        newPage("opener");
        y = lay.pageH - lay.top - (lay.manuscript ? lay.pageH * 0.18 : lay.pageH * 0.14);
      } else {
        ensure(lay.leading * 8);
        y -= lay.leading * 2;
      }
      bodyStarted = true;
      if (h.label) {
        if (lay.manuscript) centered(h.label, { size: lay.size, font: fonts.regular, after: h.title ? 2 : 24 });
        else centered(h.label.toUpperCase(), { size: 9.5, font: fonts.regular, spacing: 2.4, after: h.title ? 10 : 30 });
      }
      if (h.title) {
        if (lay.manuscript) centered(h.title, { size: lay.size, font: fonts.regular, after: 24 });
        else centered(h.title, { size: 17, font: fonts.italic, after: 30 });
      }
      opener = true;
      dropPending = opening.style !== "off";
      ch.scenes.forEach((sc, i) => {
        if (i > 0) sceneBreak();
        renderBlocks(sc.blocks, i > 0);
        opener = false;
        dropPending = false;
      });
      if (!notesAtBookEnd && !notesBottom) {
        const notes = chapterNotes(ch);
        if (notes.length) {
          ensure(lay.leading * 4);
          addParagraph([{ text: "Notes", b: true }], { size: lay.size - 1, leading: lay.leading, before: lay.leading, after: 3, align: "left" });
          for (const n of notes) addParagraph([{ text: `${n.n}. ` }, ...n.runs], { size: lay.size - 1.5, leading: lay.leading * 0.88, align: "left", after: 2 });
        }
      }
    }
  }

  if (notesAtBookEnd && hasNotes(m)) {
    newPage("opener");
    y = lay.pageH - lay.top - lay.pageH * 0.08;
    centered("Notes", { size: lay.manuscript ? 12 : 16, font: fonts.bold, after: 16 });
    for (const { chapter, notes } of bookNotes(m)) {
      const h = chapterHeading(chapter, opts.chapterStyle);
      ensure(lay.leading * 4);
      addParagraph([{ text: [h.label, h.title].filter(Boolean).join(": ") || chapter.title, b: true }], { size: lay.size - 1, leading: lay.leading, before: lay.leading * 0.6, after: 3, align: "left" });
      for (const n of notes) addParagraph([{ text: `${n.n}. ` }, ...n.runs], { size: lay.size - 1.5, leading: lay.leading * 0.88, align: "left", after: 2 });
    }
  }

  if (m.about) {
    newPage("opener");
    y = lay.pageH * 0.75;
    centered("About the Author", { size: lay.manuscript ? 12 : 14, font: fonts.bold, after: 16 });
    for (const t of m.about.split(/\n+/)) addParagraph([{ text: t }], { indent: true });
  } else if (lay.manuscript) {
    ensure(lay.leading * 3);
    centered("THE END", { size: lay.size, font: fonts.regular, before: lay.leading });
  }

  // ------------------------------------------------------ notes at the foot
  if (notesBottom) {
    pages.forEach((p, i) => {
      if (!p.foot.length) return;
      const x = leftMargin(i);
      const w = textWidth();
      const top = baseBottom() + 2 + (p.foot.length - 1) * footLead;
      p.page.drawLine({ start: { x, y: top + footLead * 0.8 }, end: { x: x + w * 0.28, y: top + footLead * 0.8 }, thickness: 0.4, color: rgb(0.4, 0.4, 0.4) });
      p.foot.forEach((l, k) => drawLine(p.page, l.atoms, l.a, l.b, x, top - k * footLead, footSize, w, false));
    });
  }

  // ------------------------------------------------- headers, footers, numbers
  const firstBodyIdx = pages.findIndex((p) => p.kind === "opener");
  const startIdx = lay.manuscript ? (rl.titlePage ? 1 : 0) : Math.max(0, firstBodyIdx);
  pages.forEach((p, i) => {
    if (i >= startIdx) p.number = i - startIdx + 1;
  });
  const small = lay.manuscript ? 12 : 8.5;
  pages.forEach((p, i) => {
    if (p.number === null) return;
    const recto = isRecto(i);
    if (lay.manuscript) {
      if (i < startIdx || (!rl.runningHeader && !rl.pageNumbers)) return;
      const head = rl.runningHeader ? [m.surname || m.author, m.title.toUpperCase()].filter(Boolean).join(" / ") : "";
      const t = safe(rl.pageNumbers ? (head ? `${head} / ${p.number}` : String(p.number)) : head);
      const w = widthOf(fonts.regular, t, small);
      p.page.drawText(t, { x: lay.pageW - lay.outer - w, y: lay.pageH - lay.top + 28, size: small, font: fonts.regular });
      return;
    }
    // trade: running head on non-opener pages, folio at foot
    if (p.kind !== "opener" && rl.runningHeader) {
      const text = safe(recto ? m.title : m.author).toUpperCase();
      const spacing = 1.4;
      const w = [...text].reduce((n, ch) => n + widthOf(fonts.regular, ch, small) + spacing, 0) - spacing;
      let x = (recto ? lay.inner : lay.outer) + (textWidth() - w) / 2;
      const yy = lay.pageH - lay.top + 22;
      for (const ch of text) {
        p.page.drawText(ch, { x, y: yy, size: small, font: fonts.regular, color: rgb(0.25, 0.25, 0.25) });
        x += widthOf(fonts.regular, ch, small) + spacing;
      }
    }
    if (!rl.pageNumbers) return;
    const num = String(p.number);
    const nw = widthOf(fonts.regular, num, 9);
    p.page.drawText(num, { x: (recto ? lay.inner : lay.outer) + (textWidth() - nw) / 2, y: lay.bottom - 28, size: 9, font: fonts.regular });
  });

  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
