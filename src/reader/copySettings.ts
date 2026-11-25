/** How words copied from a reader are written: verse numbers, joins between verses, quote style. Pure. */

export interface CopySettings {
  /** put the verse number before each verse */
  verseNumbers: boolean;
  /** verse numbers as small raised digits */
  superscript: boolean;
  /** put the chapter in front of the verse number (3:16) */
  chapterNumbers: boolean;
  /** write … between verses that do not follow one another */
  ellipsis: boolean;
  /** label the footnote with a letter (a, b…) rather than a number */
  letters: boolean;
  /** a block quote; off writes the words inline in quotation marks */
  asQuote: boolean;
}

export const DEFAULT_COPY: CopySettings = { verseNumbers: false, superscript: true, chapterNumbers: false, ellipsis: true, letters: false, asQuote: true };

export function parseCopy(raw: unknown): CopySettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof CopySettings) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_COPY[k]);
  return { verseNumbers: pick("verseNumbers"), superscript: pick("superscript"), chapterNumbers: pick("chapterNumbers"), ellipsis: pick("ellipsis"), letters: pick("letters"), asQuote: pick("asQuote") };
}

const RAISED = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export const raised = (n: number | string): string => String(n).replace(/\d/g, (d) => RAISED[Number(d)]);

export interface VerseText {
  chapter: number;
  verse: number;
  text: string;
}

/** Whole verses as one piece of text, written the way the settings say. */
export function formatVerses(verses: VerseText[], s: CopySettings): string {
  let out = "";
  let prev: VerseText | null = null;
  for (const v of verses) {
    const text = v.text.trim();
    if (!text) continue;
    let label = "";
    if (s.verseNumbers) {
      const num = s.chapterNumbers ? (s.superscript ? `${raised(v.chapter)}·${raised(v.verse)}` : `${v.chapter}:${v.verse}`) : s.superscript ? raised(v.verse) : String(v.verse);
      label = s.superscript ? num : `${num} `;
    }
    if (prev) {
      const apart = v.chapter !== prev.chapter || v.verse !== prev.verse + 1;
      out += s.ellipsis && apart ? " … " : " ";
    }
    out += label + text;
    prev = v;
  }
  return out;
}

/** The flags a quotation carries so the note it is written into follows the settings. */
export const flagsOf = (s: CopySettings): { letters?: boolean; inline?: boolean } => ({ ...(s.letters && { letters: true }), ...(!s.asQuote && { inline: true }) });
