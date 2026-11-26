/** The writing format a project can set for itself. It is kept in the project note's properties (`writingFormat`); a project without it uses the plugin's default. Pure. */
import type { WritingFormat } from "./format";
import { DEFAULT_OPENING, resolveOpening, type Opening } from "./initials";

export interface FormatBundle {
  writing: WritingFormat;
  opening: Opening;
}

/** What is stored: every field flat, so the note's properties stay readable. */
export type FormatFm = Partial<{
  on: boolean;
  indent: number;
  paragraphGap: number;
  dialogueGap: number;
  autoIndent: boolean;
  indentFirst: boolean;
  tabIndent: boolean;
  bar: boolean;
  bookFont: boolean;
  openingStyle: Opening["style"];
  openingFrame: Opening["frame"];
  openingLines: Opening["lines"];
  openingMatter: boolean;
}>;

export const FORMAT_FM_KEY = "writingFormat";

/** The project's own format, or null when it uses the plugin default. */
export function readProjectFormat(fm: Record<string, unknown> | undefined | null): FormatFm | null {
  const raw = fm?.[FORMAT_FM_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as FormatFm) : null;
}

/** The default with a project's own choices laid over it. A missing or odd field falls back to the default. */
export function effectiveFormat(def: FormatBundle, own: FormatFm | null): FormatBundle {
  if (!own) return def;
  const w = { ...def.writing };
  const num = (k: "indent" | "paragraphGap" | "dialogueGap") => {
    const v = own[k];
    if (typeof v === "number" && Number.isFinite(v)) w[k] = v;
  };
  const flag = (k: "on" | "autoIndent" | "indentFirst" | "tabIndent" | "bar" | "bookFont") => {
    const v = own[k];
    if (typeof v === "boolean") w[k] = v;
  };
  (["indent", "paragraphGap", "dialogueGap"] as const).forEach(num);
  (["on", "autoIndent", "indentFirst", "tabIndent", "bar", "bookFont"] as const).forEach(flag);
  const opening = resolveOpening({ ...def.opening, ...(own.openingStyle && { style: own.openingStyle }), ...(own.openingFrame && { frame: own.openingFrame }), ...(own.openingLines && { lines: own.openingLines }), ...(typeof own.openingMatter === "boolean" && { matter: own.openingMatter }) });
  return { writing: w, opening };
}

/** A whole bundle as the flat properties that are stored. */
export function toFormatFm(b: FormatBundle): FormatFm {
  const { on, indent, paragraphGap, dialogueGap, autoIndent, indentFirst, tabIndent, bar, bookFont } = b.writing;
  return { on, indent, paragraphGap, dialogueGap, autoIndent, indentFirst, tabIndent, bar, bookFont, openingStyle: b.opening.style, openingFrame: b.opening.frame, openingLines: b.opening.lines, openingMatter: b.opening.matter === true };
}

export const defaultBundle = (writing: WritingFormat, opening?: Partial<Opening> | null): FormatBundle => ({ writing, opening: resolveOpening(opening ?? DEFAULT_OPENING) });
