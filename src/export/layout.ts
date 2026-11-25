import type { ExportOptions } from "./headings";

/** What the "Advanced" window can change. A field left out keeps the default of the chosen look (manuscript or book). */
export type PageSize = "default" | "letter" | "a4" | "a5" | "5x8" | "5.5x8.5" | "6x9" | "custom";
export type FontFamily = "default" | "serif" | "times" | "sans" | "mono" | "custom";
export type Toggle = "default" | "on" | "off";

export interface Advanced {
  pageSize?: PageSize;
  /** inches, used when pageSize is "custom" */
  customWidth?: number;
  customHeight?: number;
  /** inches; inner is the binding side */
  marginTop?: number;
  marginBottom?: number;
  marginInner?: number;
  marginOuter?: number;
  fontFamily?: FontFamily;
  /** a font name installed on the reader's computer, used for Word and ePub */
  customFont?: string;
  /** points */
  fontSize?: number;
  /** 1 = single, 2 = double */
  lineSpacing?: number;
  /** inches */
  firstLineIndent?: number;
  /** points of space after each paragraph */
  paragraphSpacing?: number;
  justify?: Toggle;
  breakBeforeChapter?: boolean;
  breakBeforeAct?: boolean;
  pageNumbers?: Toggle;
  runningHeader?: Toggle;
  titlePage?: boolean;
  /** inner and outer margins swap on facing pages (Word and PDF); on by default for the book look */
  mirrorMargins?: Toggle;
}

export type PdfFace = "embedded" | "courier" | "times" | "helvetica";

export interface ResolvedLayout {
  /** inches */
  pageW: number;
  pageH: number;
  top: number;
  bottom: number;
  inner: number;
  outer: number;
  fontSize: number;
  line: number;
  indent: number;
  paraAfter: number;
  justify: boolean;
  /** for Word and ePub: a font name or CSS stack */
  docxFont: string;
  cssFont: string;
  /** true when the reader chose a font, so an ePub should not override the reader's own */
  fontChosen: boolean;
  pdfFace: PdfFace;
  breakBeforeChapter: boolean;
  breakBeforeAct: boolean;
  pageNumbers: boolean;
  runningHeader: boolean;
  titlePage: boolean;
  mirror: boolean;
}

const SIZES: Record<Exclude<PageSize, "default" | "custom">, [number, number]> = {
  letter: [8.5, 11],
  a4: [8.27, 11.69],
  a5: [5.83, 8.27],
  "5x8": [5, 8],
  "5.5x8.5": [5.5, 8.5],
  "6x9": [6, 9],
};

const FAMILIES: Record<Exclude<FontFamily, "default" | "custom">, { docx: string; css: string; pdf: PdfFace }> = {
  serif: { docx: "Georgia", css: 'Georgia, "Times New Roman", serif', pdf: "embedded" },
  times: { docx: "Times New Roman", css: '"Times New Roman", Times, serif', pdf: "times" },
  sans: { docx: "Arial", css: "Arial, Helvetica, sans-serif", pdf: "helvetica" },
  mono: { docx: "Courier New", css: '"Courier New", Courier, monospace', pdf: "courier" },
};

const num = (v: unknown): number | undefined => (typeof v === "number" && isFinite(v) && v >= 0 ? v : undefined);
const clamp = (v: number | undefined, lo: number, hi: number, d: number) => (v === undefined ? d : Math.min(hi, Math.max(lo, v)));
const pick = (t: Toggle | undefined, d: boolean) => (t === "on" ? true : t === "off" ? false : d);

/** Turn the chosen look plus the advanced overrides into concrete numbers every writer can use. */
export function resolveLayout(opts: Pick<ExportOptions, "preset" | "trimSize"> & { advanced?: Advanced }): ResolvedLayout {
  const a = opts.advanced ?? {};
  const ms = opts.preset === "manuscript";

  let [w, h] = ms ? SIZES.letter : SIZES[opts.trimSize] ?? SIZES["5.5x8.5"];
  if (a.pageSize && a.pageSize !== "default") {
    if (a.pageSize === "custom") {
      w = clamp(num(a.customWidth), 3, 17, w);
      h = clamp(num(a.customHeight), 3, 17, h);
    } else [w, h] = SIZES[a.pageSize];
  }

  const base = ms ? { top: 1, bottom: 1, inner: 1, outer: 1 } : { top: 0.75, bottom: 0.85, inner: 0.85, outer: 0.6 };
  // margins can never leave less than an inch of text on the page
  const m = {
    top: clamp(num(a.marginTop), 0.25, 3, base.top),
    bottom: clamp(num(a.marginBottom), 0.25, 3, base.bottom),
    inner: clamp(num(a.marginInner), 0.25, 3, base.inner),
    outer: clamp(num(a.marginOuter), 0.25, 3, base.outer),
  };
  if (m.inner + m.outer > w - 1) m.inner = m.outer = Math.max(0.25, (w - 1) / 2);
  if (m.top + m.bottom > h - 1) m.top = m.bottom = Math.max(0.25, (h - 1) / 2);

  const fam = a.fontFamily && a.fontFamily !== "default" ? a.fontFamily : null;
  let docxFont = ms ? "Times New Roman" : "Georgia";
  let cssFont = ms ? FAMILIES.times.css : FAMILIES.serif.css;
  let pdfFace: PdfFace = ms ? "courier" : "embedded";
  let fontChosen = false;
  if (fam === "custom") {
    const name = (a.customFont ?? "").replace(/["'<>;{}\\]/g, "").trim();
    if (name) {
      docxFont = name;
      cssFont = `"${name}", serif`;
      pdfFace = "embedded";
      fontChosen = true;
    }
  } else if (fam) {
    docxFont = FAMILIES[fam].docx;
    cssFont = FAMILIES[fam].css;
    pdfFace = FAMILIES[fam].pdf;
    fontChosen = true;
  }

  return {
    pageW: w,
    pageH: h,
    top: m.top,
    bottom: m.bottom,
    inner: m.inner,
    outer: m.outer,
    fontSize: clamp(num(a.fontSize), 7, 24, ms ? 12 : 10.5),
    line: clamp(num(a.lineSpacing), 1, 3, ms ? 2 : 1.4),
    indent: clamp(num(a.firstLineIndent), 0, 2, ms ? 0.5 : 0.22),
    paraAfter: clamp(num(a.paragraphSpacing), 0, 36, 0),
    justify: pick(a.justify, !ms),
    docxFont,
    cssFont,
    fontChosen,
    pdfFace,
    breakBeforeChapter: a.breakBeforeChapter ?? true,
    breakBeforeAct: a.breakBeforeAct ?? true,
    pageNumbers: pick(a.pageNumbers, true),
    runningHeader: pick(a.runningHeader, true),
    titlePage: a.titlePage ?? true,
    mirror: pick(a.mirrorMargins, !ms),
  };
}
