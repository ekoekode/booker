/** The Berean word-for-word tables read as a Bible: each verse is the English under its Hebrew or Greek words, in their order, each word tagged with its Strong's number. Pure. */
import type { IWord } from "./interlinear";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A gloss the tables leave blank or mark as a placeholder says nothing. */
const empty = (g: string) => !g || /^[-–—]+$/.test(g) || /^v+$/i.test(g);

/** One verse in e-Sword markup: every English word is followed by the tag of the number it renders. */
export function interlinearVerse(words: IWord[]): string {
  const out: string[] = [];
  for (const w of words) {
    const g = (w.g ?? "").trim();
    if (empty(g)) continue;
    const tag = /^[HG]\d+/.test(w.s) ? `<W${w.s.slice(0, 1)}${w.s.slice(1)}>` : "";
    for (const part of g.split(/\s+/)) out.push(`${esc(part)}${tag}`);
  }
  return out.join(" ");
}

export const INTERLINEAR_TITLE = "Berean Interlinear Bible";
