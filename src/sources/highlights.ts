/** Highlights as they are kept in `Sources/<title>/Highlights.md`: a readable quote plus the data to find it again. */

export interface Highlight {
  uid: string;
  /** the source's uid */
  source: string;
  loc: string;
  page?: number;
  text: string;
  /** a little text on each side, to find this one when the same words occur twice */
  prefix: string;
  suffix: string;
  color: string;
  comment?: string;
  created: number;
}

const TAG = /<!-- booker-hl (\{[^\n]*\}) -->/g;

export function formatHighlight(h: Highlight): string {
  const quote = h.text.split(/\n+/).map((l) => `> ${l}`).join("\n>\n");
  const json = JSON.stringify(h).replace(/--/g, "\\u002d\\u002d");
  return `${quote}\n> — ${h.loc}${h.comment ? `\n\nNote: ${h.comment.replace(/\n+/g, " ")}` : ""}\n${"<!-- booker-hl " + json + " -->"}\n`;
}

export function parseHighlights(md: string): Highlight[] {
  const out: Highlight[] = [];
  for (const m of md.matchAll(TAG)) {
    try {
      const h = JSON.parse(m[1]) as Highlight;
      if (h && typeof h.uid === "string" && typeof h.text === "string") out.push(h);
    } catch {
      /* a hand-edited tag that no longer parses is skipped */
    }
  }
  return out;
}

export function highlightsFile(existing: string, h: Highlight): string {
  const body = existing.trim() ? existing.replace(/\s+$/, "") + "\n\n" : "";
  return body + formatHighlight(h);
}

export function removeHighlight(md: string, uid: string): string {
  const blocks = md.split(/\n{2,}(?=>)/);
  return blocks.filter((b) => !b.includes(`"uid":"${uid}"`)).join("\n\n").replace(/\s*$/, "\n");
}

/** The same file with one highlight replaced by a changed copy (a new colour or comment). */
export function updateHighlight(md: string, h: Highlight): string {
  const blocks = md.split(/\n{2,}(?=>)/);
  return blocks.map((b) => (b.includes(`"uid":"${h.uid}"`) ? formatHighlight(h).trimEnd() : b)).join("\n\n").replace(/\s*$/, "\n");
}

/** Where a highlight sits in a chunk's text: the offset of the best occurrence, or -1. Whitespace differences are ignored. */
export function locate(chunk: string, h: Pick<Highlight, "text" | "prefix" | "suffix">): number {
  const squash = (s: string) => s.replace(/\s+/g, " ");
  const text = squash(chunk);
  const needle = squash(h.text).trim();
  if (!needle) return -1;
  let best = -1;
  let score = -1;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const before = text.slice(Math.max(0, at - h.prefix.length), at);
    const after = text.slice(at + needle.length, at + needle.length + h.suffix.length);
    let s = 0;
    for (let i = 1; i <= Math.min(before.length, h.prefix.length); i++) if (before[before.length - i] === squash(h.prefix)[squash(h.prefix).length - i]) s++;
    for (let i = 0; i < Math.min(after.length, h.suffix.length); i++) if (after[i] === squash(h.suffix)[i]) s++;
    if (s > score) {
      score = s;
      best = at;
    }
  }
  return best;
}

/** The context to remember around a selection made in `chunk` from `start` to `end`. */
export function context(chunk: string, start: number, end: number, n = 32): { prefix: string; suffix: string } {
  return { prefix: chunk.slice(Math.max(0, start - n), start), suffix: chunk.slice(end, end + n) };
}
