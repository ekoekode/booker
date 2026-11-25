/** When a scene note is worth summarising in the background, and what to summarise. Pure. */
import { withoutSummaries } from "../semantic/summary";

export const MIN_WORDS = 150;

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** The text of a note to summarise: no frontmatter, no earlier summary callouts. */
export function bodyOf(note: string): string {
  return withoutSummaries(note.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")).trim();
}

/** A summary is due when the note is long enough and has none, or has changed a good deal since the last one (a fifth of it, and at least 100 words). */
export function summaryDue(words: number, summarizedWords: number | undefined): boolean {
  if (words < MIN_WORDS) return false;
  if (summarizedWords === undefined) return true;
  return Math.abs(words - summarizedWords) >= Math.max(100, summarizedWords * 0.2);
}

/** Keep a summary on one line of frontmatter. */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const wordsOf = (t: string) => t.toLowerCase().match(/[\p{L}][\p{L}'’]{3,}/gu) ?? [];

/** Whether a written summary is about the text it was written from: most of its longer words occur in the text (or begin like one that does). A small model given too little text invents things; those fail this. Pure. */
export function grounded(summary: string, source: string, least = 0.6): boolean {
  const have = new Set(wordsOf(source));
  const stems = new Set([...have].map((w) => w.slice(0, 5)));
  const mine = wordsOf(summary);
  if (mine.length < 3) return false;
  const hit = mine.filter((w) => have.has(w) || stems.has(w.slice(0, 5))).length;
  return hit / mine.length >= least;
}
