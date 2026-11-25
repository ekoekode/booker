/** Inserting a footnote into a note's text. Pure: takes the text and cursor, returns what to change. */

export interface FootnoteEdit {
  /** the mark goes here */
  markAt: number;
  mark: string;
  /** the note's own line goes at the very end */
  appendAt: number;
  append: string;
  /** where the cursor lands afterwards, in the text once both changes are made */
  cursor: number;
  label: string;
}

/** The next free numeric label: one more than the highest number already used as [^n]. */
export function nextLabel(text: string): string {
  let max = 0;
  for (const m of text.matchAll(/\[\^(\d{1,6})\]/g)) max = Math.max(max, Number(m[1]));
  return String(max + 1);
}

/** The next free letter label: a, b, c… skipping the ones used as [^x]; numbers once the letters run out. */
export function nextLetterLabel(text: string): string {
  const used = new Set([...text.matchAll(/\[\^([a-z])\]/g)].map((m) => m[1]));
  for (const c of "abcdefghijklmnopqrstuvwxyz") if (!used.has(c)) return c;
  return nextLabel(text);
}

export function planFootnote(text: string, at: number, letters = false): FootnoteEdit {
  const label = letters ? nextLetterLabel(text) : nextLabel(text);
  const mark = `[^${label}]`;
  const body = text.replace(/\s+$/, "");
  const lastLine = body.slice(body.lastIndexOf("\n") + 1);
  const afterDef = /^\[\^[^\]\[\n]{1,200}\]:/.test(lastLine);
  const append = `${afterDef ? "\n" : "\n\n"}[^${label}]: `;
  const appendAt = body.length;
  // the mark lands before the end of the text, so the note's line moves right by the mark's length when it is earlier
  const cursor = (at <= appendAt ? appendAt + mark.length : appendAt) + append.length;
  return { markAt: at, mark, appendAt, append, cursor, label };
}
