import JSZip from "jszip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  DropCapType,
  Footer,
  FootnoteReferenceRun,
  FrameAnchorType,
  FrameWrap,
  Header,
  HeadingLevel,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  IParagraphOptions,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  TabStopType,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from "docx";
import { dropLetter, isFontStyle, resolveOpening, type Opening } from "../writing/initials";
import { ILLUMINATED, OPENING_FONT_FILES } from "../writing/initialsData";
import { actHeading, chapterHeading, ExportOptions } from "./headings";
import { resolveLayout } from "./layout";
import { cleanXml } from "../text";
import { Block, cleanManuscript, Manuscript, plainText, roundedWords, Run } from "./model";
import { scriptSegments } from "./script";
import { bookNotes, chapterNotes, hasNotes, numberNotes, type NoteItem, type NotePlacement } from "./notes";

const IN = 1440; // twips per inch

type Mark = TextRun | FootnoteReferenceRun;

/** Where a note's number goes: a real Word footnote (page bottom), or a raised number that points to a list. */
let noteMode: NotePlacement = "chapter";

function runs(rs: Run[], font: string, size: number, extra: { bold?: boolean; italics?: boolean; allCaps?: boolean } = {}): Mark[] {
  return rs.flatMap((r): Mark[] => {
    if (r.note && noteMode === "bottom") return [new FootnoteReferenceRun(r.noteNo!)];
    if (r.note) return [new TextRun({ text: String(r.noteNo), font, size, superScript: true })];
    return scriptSegments(r.text).map(
      (seg) =>
        new TextRun({
          text: seg.t,
          // Hebrew runs read right to left; Word's own Times New Roman has the letters and the points
          font: seg.he ? "Times New Roman" : font,
          size,
          bold: r.b || extra.bold,
          italics: r.i || extra.italics,
          strike: r.s,
          superScript: r.sup,
          allCaps: extra.allCaps,
          ...(seg.he && { rightToLeft: true }),
        })
    );
  });
}

function noteParagraph(it: NoteItem, st: Style, label: boolean): Paragraph {
  const size = Math.max(16, st.size - 2);
  return new Paragraph({
    spacing: { line: 240, lineRule: LineRuleType.AUTO, after: 60 },
    children: [...(label ? [new TextRun({ text: `${it.n}. `, font: st.font, size })] : []), ...(runs(it.runs, st.font, size) as TextRun[])],
  });
}

function noteHeading(text: string, st: Style, level: 1 | 2): Paragraph {
  return new Paragraph({
    keepNext: true,
    alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: level === 1 ? 480 : 240, after: 120, line: 240, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text, font: st.font, size: level === 1 ? st.size + 4 : st.size, bold: true })],
  });
}

interface Style {
  font: string;
  size: number; // half-points
  line: number; // 240 = single
  indent: number; // first-line twips
  justify: boolean;
  pageW: number;
  pageH: number;
  margin: { top: number; bottom: number; left: number; right: number };
  breakMark: string;
  /** twips of space after each paragraph */
  after: number;
}

/** Word's names for the opening fonts. Word uses them if they are installed on the reader's computer and falls back to another font if not. */
const WORD_FONT = { fell: "IM FELL Double Pica", jacquard: "Jacquard 24", cinzel: "Cinzel Decorative" } as const;

/** The chapter's first paragraph with its large first letter: the artwork as a floating picture the text wraps around, or a Word drop cap in the chosen font. */
function dropCapParagraphs(rs: Run[], base: IParagraphOptions, st: Style, o: Opening): Paragraph[] | null {
  const first = rs[0];
  const dl = first && !first.note && !first.sup ? dropLetter(first.text) : null;
  if (!dl) return null;
  const rest: Run[] = [{ ...first, text: dl.rest }, ...rs.slice(1)];
  const body = (extra: Partial<IParagraphOptions> = {}, lead: Array<Mark | ImageRun> = []) => new Paragraph({ ...base, indent: { firstLine: 0 }, ...extra, children: [...lead, ...runs(rest, st.font, st.size)] as Mark[] });
  if (o.style === "art") {
    const png = ILLUMINATED[dl.ch] as unknown;
    if (!(png instanceof Uint8Array)) return null;
    // as tall as the chosen number of lines of text (a line is the font size times the line spacing, with a little for Word's own spacing)
    const linePt = (st.size / 2) * (st.line / 240) * 1.2;
    const h = Math.round(((o.lines * linePt - 2) * 96) / 72);
    const w = Math.round((h * 301) / 323);
    const pic = new ImageRun({
      type: "png",
      data: png,
      transformation: { width: w, height: h },
      floating: {
        horizontalPosition: { relative: HorizontalPositionRelativeFrom.MARGIN, align: HorizontalPositionAlign.LEFT },
        verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
        wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES },
        margins: { right: 76200, left: 0, top: 0, bottom: 0 },
      },
    });
    return [body({}, [pic])];
  }
  if (!isFontStyle(o.style)) return null;
  const line = { style: BorderStyle.SINGLE, size: 8, color: "000000", space: 2 };
  const frameBorder = o.frame === "single" ? line : o.frame === "double" ? { style: BorderStyle.DOUBLE, size: 8, color: "000000", space: 2 } : undefined;
  const block = o.frame === "block";
  const cap = new Paragraph({
    frame: { type: "absolute", position: { x: 0, y: 0 }, anchor: { horizontal: FrameAnchorType.TEXT, vertical: FrameAnchorType.TEXT }, dropCap: DropCapType.DROP, lines: o.lines, wrap: FrameWrap.AROUND },
    spacing: { line: st.line, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
    ...(frameBorder && { border: { top: frameBorder, bottom: frameBorder, left: frameBorder, right: frameBorder } }),
    ...(block && { shading: { type: ShadingType.CLEAR, fill: "000000", color: "auto" } }),
    children: [new TextRun({ text: dl.ch, font: WORD_FONT[o.style], size: st.size * o.lines, bold: OPENING_FONT_FILES[o.style].weight === "bold", ...(block && { color: "FFFFFF" }) })],
  });
  return [cap, body()];
}

interface DropState {
  /** the large first letter is still to be put on the next paragraph */
  pending: boolean;
  opening: Opening;
}

function bodyParagraphs(blocks: Block[], st: Style, afterBreak: boolean, drop?: DropState): Paragraph[] {
  const out: Paragraph[] = [];
  let firstInScene = true;
  for (const b of blocks) {
    const base: IParagraphOptions = {
      spacing: { line: st.line, lineRule: LineRuleType.AUTO, after: st.after, before: 0 },
      alignment: st.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    };
    switch (b.kind) {
      case "p": {
        const noIndent = firstInScene && afterBreak;
        const capped = drop?.pending ? dropCapParagraphs(b.runs, base, st, drop.opening) : null;
        if (drop) drop.pending = false;
        if (capped) out.push(...capped);
        else out.push(new Paragraph({ ...base, indent: { firstLine: noIndent ? 0 : st.indent }, children: runs(b.runs, st.font, st.size) }));
        firstInScene = false;
        break;
      }
      case "quote":
        out.push(new Paragraph({ ...base, indent: { left: IN * 0.5, right: IN * 0.5 }, children: runs(b.runs, st.font, st.size, { italics: true }) }));
        firstInScene = false;
        break;
      case "date": {
        const s = b.style;
        out.push(
          new Paragraph({
            ...base,
            alignment: s.align === "center" ? AlignmentType.CENTER : s.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
            spacing: { ...base.spacing, before: 120, after: 160 },
            indent: { firstLine: 0 },
            keepNext: true,
            children: runs(b.runs, st.font, Math.round((st.size * s.size) / 100), { italics: s.italic, bold: s.bold }),
          })
        );
        firstInScene = false;
        break;
      }
      case "h":
        out.push(
          new Paragraph({
            ...base,
            alignment: AlignmentType.CENTER,
            spacing: { ...base.spacing, before: 240, after: 240 },
            keepNext: true,
            children: runs(b.runs, st.font, st.size, { bold: true }),
          })
        );
        break;
      case "li":
        out.push(
          new Paragraph({
            ...base,
            indent: { left: IN * 0.5, hanging: IN * 0.25 },
            children: [new TextRun({ text: b.ordered ? `${b.n}.\t` : "•\t", font: st.font, size: st.size }), ...runs(b.runs, st.font, st.size)],
          })
        );
        break;
      case "rule":
        out.push(sceneBreak(st));
        firstInScene = true;
        break;
    }
  }
  return out;
}

function sceneBreak(st: Style): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: st.line, lineRule: LineRuleType.AUTO, before: st.line > 300 ? 0 : 240, after: st.line > 300 ? 0 : 240 },
    keepNext: true,
    children: [new TextRun({ text: st.breakMark, font: st.font, size: st.size })],
  });
}

export async function buildDocx(m0: Manuscript, opts: ExportOptions, sceneBreakMark0: string): Promise<ArrayBuffer> {
  noteMode = opts.notePlacement ?? "bottom";
  // Word numbers page-bottom footnotes itself, straight through the document
  const m = numberNotes(cleanManuscript(m0), noteMode === "bottom" ? "book" : opts.noteNumbering ?? "chapter");
  const sceneBreakMark = cleanXml(sceneBreakMark0);
  const opening = resolveOpening(opts.opening);
  const manuscript = opts.preset === "manuscript";
  const lay = resolveLayout(opts);
  const st: Style = {
    font: lay.docxFont,
    size: Math.round(lay.fontSize * 2),
    line: Math.round(lay.line * 240),
    indent: Math.round(lay.indent * IN),
    justify: lay.justify,
    pageW: Math.round(lay.pageW * IN),
    pageH: Math.round(lay.pageH * IN),
    margin: { top: Math.round(lay.top * IN), bottom: Math.round(lay.bottom * IN), left: Math.round(lay.inner * IN), right: Math.round(lay.outer * IN) },
    breakMark: manuscript ? "#" : sceneBreakMark,
    after: Math.round(lay.paraAfter * 20),
  };

  const page = { size: { width: st.pageW, height: st.pageH }, margin: st.margin };
  const contentW = st.pageW - st.margin.left - st.margin.right;
  const sections: any[] = [];

  // ---------------------------------------------------------- front
  const front: Paragraph[] = [];
  if (manuscript) {
    const contact = m.contact.split(/\r?\n/).filter(Boolean);
    const words = `About ${roundedWords(m.words).toLocaleString("en-US")} words`;
    const single = { line: 240, lineRule: LineRuleType.AUTO, after: 0 } as const;
    const first = contact[0] ?? m.author;
    front.push(
      new Paragraph({
        spacing: single,
        tabStops: [{ type: TabStopType.RIGHT, position: contentW }],
        children: [new TextRun({ text: first, font: st.font, size: st.size }), new TextRun({ text: `\t${words}`, font: st.font, size: st.size })],
      })
    );
    for (const l of contact.slice(1)) front.push(new Paragraph({ spacing: single, children: [new TextRun({ text: l, font: st.font, size: st.size })] }));
    front.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 3200, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [new TextRun({ text: m.title.toUpperCase(), font: st.font, size: st.size })],
      })
    );
    if (m.subtitle)
      front.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [new TextRun({ text: m.subtitle, font: st.font, size: st.size, italics: true })] }));
    if (m.author.trim())
      front.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, line: 240, lineRule: LineRuleType.AUTO },
          children: [new TextRun({ text: `by ${m.author}`, font: st.font, size: st.size })],
        })
      );
    if (lay.titlePage) sections.push({ properties: { page }, children: front });
  } else {
    front.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2600, after: 240, line: 240, lineRule: LineRuleType.AUTO },
        children: [new TextRun({ text: m.title, font: st.font, size: 56, bold: true })],
      })
    );
    if (m.subtitle)
      front.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: m.subtitle, font: st.font, size: 28, italics: true })] }));
    front.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 800 }, children: [new TextRun({ text: m.author, font: st.font, size: 30 })] }));
    if (m.copyright)
      front.push(new Paragraph({ children: [new PageBreak()] }), new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 6000 }, children: [new TextRun({ text: m.copyright, font: st.font, size: 18 })] }));
    if (m.dedication)
      front.push(
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 3600 }, children: [new TextRun({ text: m.dedication, font: st.font, size: st.size, italics: true })] })
      );
    if (lay.titlePage) sections.push({ properties: { page }, children: front });
  }

  // ----------------------------------------------------------- body
  const body: Paragraph[] = [];
  let firstChapter = true;
  for (const act of m.acts) {
    if (act.titled && opts.actTitles) {
      body.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: lay.breakBeforeAct,
          alignment: AlignmentType.CENTER,
          spacing: { before: lay.breakBeforeAct ? (manuscript ? 4000 : 3600) : 720, after: 240, line: 240, lineRule: LineRuleType.AUTO },
          children: [new TextRun({ text: actHeading(act), font: st.font, size: manuscript ? st.size : 40, bold: !manuscript })],
        })
      );
    }
    for (const ch of act.chapters) {
      const h = chapterHeading(ch, opts.chapterStyle);
      const needsBreak = lay.breakBeforeChapter;
      let first = true;
      if (h.label) {
        body.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            pageBreakBefore: needsBreak,
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: needsBreak ? (manuscript ? 2400 : 1800) : 480, after: h.title ? 0 : 480, line: 240, lineRule: LineRuleType.AUTO },
            children: [new TextRun({ text: h.label, font: st.font, size: manuscript ? st.size : 36, bold: !manuscript })],
          })
        );
        first = false;
      }
      if (h.title) {
        body.push(
          new Paragraph({
            // the title under a "Chapter 1" label is part of that heading; on its own it is the chapter's heading
            ...(first ? { heading: HeadingLevel.HEADING_2 } : { style: "BookerChapterTitle" }),
            pageBreakBefore: first && needsBreak,
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: first ? (needsBreak ? (manuscript ? 2400 : 1800) : 480) : 120, after: 480, line: 240, lineRule: LineRuleType.AUTO },
            children: [new TextRun({ text: h.title, font: st.font, size: manuscript ? st.size : 30, italics: !manuscript })],
          })
        );
      }
      firstChapter = false;
      const drop: DropState = { pending: opening.style !== "off", opening };
      ch.scenes.forEach((sc, i) => {
        if (i > 0) body.push(sceneBreak(st));
        body.push(...bodyParagraphs(sc.blocks, st, i > 0 || true, drop));
        drop.pending = false;
      });
      if (noteMode === "chapter") {
        const notes = chapterNotes(ch);
        if (notes.length) body.push(noteHeading("Notes", st, 2), ...notes.map((n) => noteParagraph(n, st, true)));
      }
    }
  }
  if (noteMode === "book" && hasNotes(m)) {
    body.push(new Paragraph({ pageBreakBefore: true, keepNext: true, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: "Notes", font: st.font, size: 32, bold: true })] }));
    for (const { chapter, notes } of bookNotes(m)) {
      const h = chapterHeading(chapter, opts.chapterStyle);
      body.push(noteHeading([h.label, h.title].filter(Boolean).join(": ") || chapter.title, st, 2), ...notes.map((n) => noteParagraph(n, st, true)));
    }
  }
  if (manuscript) {
    body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480, line: st.line, lineRule: LineRuleType.AUTO }, children: [new TextRun({ text: "THE END", font: st.font, size: st.size })] }));
  }
  if (m.about) {
    body.push(
      new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: "About the Author", font: st.font, size: 32, bold: true })] }),
      ...m.about.split(/\n+/).map((t) => new Paragraph({ spacing: { line: st.line }, indent: { firstLine: st.indent }, children: [new TextRun({ text: t, font: st.font, size: st.size })] }))
    );
  }

  const pageNo = (size: number) => new TextRun({ children: [PageNumber.CURRENT], font: st.font, size });
  const header =
    manuscript && (lay.runningHeader || lay.pageNumbers)
      ? new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { line: 240, lineRule: LineRuleType.AUTO },
              children: [
                ...(lay.runningHeader ? [new TextRun({ text: `${[m.surname || m.author, m.title.toUpperCase()].filter(Boolean).join(" / ")}${lay.pageNumbers ? " / " : ""}`, font: st.font, size: st.size })] : []),
                ...(lay.pageNumbers ? [pageNo(st.size)] : []),
              ],
            }),
          ],
        })
      : new Header({ children: [new Paragraph("")] });
  const footer =
    !manuscript && lay.pageNumbers
      ? new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [pageNo(18)] })] })
      : new Footer({ children: [new Paragraph("")] });

  sections.push({
    properties: { type: SectionType.NEXT_PAGE, page: { ...page, pageNumbers: { start: 1 } } },
    headers: { default: header },
    footers: { default: footer },
    children: body,
  });

  const footnotes: Record<number, { children: Paragraph[] }> = {};
  if (noteMode === "bottom")
    for (const a of m.acts) for (const c of a.chapters) for (const n of chapterNotes(c)) footnotes[n.n] = { children: [noteParagraph(n, st, false)] };

  const doc = new Document({
    footnotes,
    creator: m.author,
    title: m.title,
    description: m.subtitle,
    styles: {
      default: { document: { run: { font: st.font, size: st.size } } },
      // headings so Word's navigation pane and an import see the book's structure; they look like the plain paragraphs they replace
      paragraphStyles: ["Heading1", "Heading2"].map((id, i) => ({ id, name: `heading ${i + 1}`, basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: st.font, size: st.size, color: "000000", bold: false } })).concat([{ id: "BookerChapterTitle", name: "Booker chapter title", basedOn: "Normal", next: "Normal", quickFormat: false, run: { font: st.font, size: st.size, color: "000000", bold: false } }]),
    },
    sections,
  });
  const buf = await Packer.toArrayBuffer(doc);
  return lay.mirror ? mirrorMargins(buf) : buf;
}

/** Word's mirror margins is a document setting the docx library does not expose, so it is added to settings.xml. */
export async function mirrorMargins(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file("word/settings.xml");
  if (!f) return buf;
  const xml = await f.async("string");
  if (xml.includes("<w:mirrorMargins")) return buf;
  // the schema puts mirrorMargins after displayBackgroundShape and before defaultTabStop
  const mark = ["<w:defaultTabStop", "<w:evenAndOddHeaders", "<w:compat"].map((t) => xml.indexOf(t)).filter((i) => i >= 0).sort((x, y) => x - y)[0];
  const at = mark ?? xml.lastIndexOf("</w:settings>");
  if (at < 0) return buf;
  zip.file("word/settings.xml", xml.slice(0, at) + "<w:mirrorMargins/>" + xml.slice(at));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

export { plainText };
