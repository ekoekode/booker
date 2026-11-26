/** The chapter opening: a large first letter, in one of three decorative fonts with an optional frame, or as illuminated artwork. Pure. */

export type OpeningStyle = "off" | "fell" | "jacquard" | "cinzel" | "art";
export type OpeningFrame = "none" | "block" | "single" | "double";

export interface Opening {
  style: OpeningStyle;
  /** drawn around a font letter; the artwork has its own frame */
  frame: OpeningFrame;
  /** how many lines of text the letter is as tall as */
  lines: 2 | 3 | 4;
  /** also on the first paragraph of front and back matter (default: only chapters and sections) */
  matter?: boolean;
}

/** On by default, as the illuminated artwork: it follows the Book styling switch in the editor, so turning that off gives plain paragraphs. */
export const DEFAULT_OPENING: Opening = { style: "art", frame: "none", lines: 2 };

export const OPENING_STYLE_LABELS: Record<OpeningStyle, string> = {
  off: "None",
  fell: "IM Fell (old printer's type)",
  jacquard: "Jacquard 24 (blackletter)",
  cinzel: "Cinzel Decorative (classical)",
  art: "Illuminated artwork",
};

export const OPENING_FRAME_LABELS: Record<OpeningFrame, string> = {
  none: "No frame",
  block: "Solid block",
  single: "Single rule",
  double: "Double rule",
};

/** CSS font family names the bundled fonts are registered under. */
export const OPENING_FONT_FAMILY = { fell: "Booker IM Fell Double Pica", jacquard: "Booker Jacquard 24", cinzel: "Booker Cinzel Decorative" } as const;

export const isFontStyle = (s: OpeningStyle): s is "fell" | "jacquard" | "cinzel" => s === "fell" || s === "jacquard" || s === "cinzel";

export function resolveOpening(o?: Partial<Opening> | null): Opening {
  const out = { ...DEFAULT_OPENING, ...(o ?? {}) };
  if (!(out.style in OPENING_STYLE_LABELS)) out.style = DEFAULT_OPENING.style;
  if (!(out.frame in OPENING_FRAME_LABELS)) out.frame = DEFAULT_OPENING.frame;
  if (![2, 3, 4].includes(out.lines)) out.lines = DEFAULT_OPENING.lines;
  out.matter = out.matter === true;
  return out;
}

/** The letter a paragraph opens with and the rest of it. Only a plain letter takes a drop cap, so a quotation mark, number or Hebrew word is left as it is. */
export function dropLetter(text: string): { ch: string; rest: string } | null {
  const m = /^([A-Za-z])([\s\S]*)$/.exec(text);
  return m ? { ch: m[1].toUpperCase(), rest: m[2] } : null;
}
