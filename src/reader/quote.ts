/** Words taken out of a reader with where they came from, so a copy or a drag into a note can carry its footnote. Pure. */

export interface Quotation {
  /** the words, paragraphs separated by a blank line */
  text: string;
  /** the footnote body that goes with them, ending in a full stop */
  footnote: string;
  /** label the footnote with a letter (a, b…) instead of a number */
  letters?: boolean;
  /** write the words into a sentence in quotation marks, not as a block quote */
  inline?: boolean;
}

/** Marks a copy or drag that came from a Booker reader; the note editor turns it into a block quote and a footnote. */
export const QUOTE_MIME = "application/x-booker-quote";

/** The footnote for words from `source` at `citation`: "BLB, John 3:16." */
export function footnoteFor(source: string, citation: string): string {
  const where = [source, citation].map((s) => s.trim()).filter(Boolean).join(", ");
  return where ? `${where.replace(/\.+$/, "")}.` : "";
}

/** Several quotations as one: their words in order, their distinct footnotes side by side. */
export function joinQuotations(qs: Quotation[]): Quotation | null {
  const list = qs.filter((q) => q.text.trim());
  if (!list.length) return null;
  const notes = list.map((q) => q.footnote).filter((f, i, a) => f && a.indexOf(f) === i);
  return { text: list.map((q) => q.text.trim()).join("\n\n"), footnote: notes.join(" ") };
}

/** What a program that knows nothing of Booker receives: the words, then where they are from. */
export function quotePlain(q: Quotation): string {
  return q.footnote ? `${q.text.trim()}\n\n— ${q.footnote}` : q.text.trim();
}

export const encodeQuote = (q: Quotation) => JSON.stringify(q);

export function decodeQuote(raw: string | undefined | null): Quotation | null {
  if (!raw) return null;
  try {
    const q = JSON.parse(raw);
    return typeof q?.text === "string" && typeof q?.footnote === "string" && q.text.trim() ? { text: q.text, footnote: q.footnote, ...(q.letters === true && { letters: true }), ...(q.inline === true && { inline: true }) } : null;
  } catch {
    return null;
  }
}

/** The block quote that goes into a note. */
export function quoteBlock(text: string): string {
  return text.trim().split(/\n+/).map((l) => `> ${l}`).join("\n>\n");
}
