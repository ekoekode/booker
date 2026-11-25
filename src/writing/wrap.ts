export interface Edit {
  changes: Array<{ from: number; to?: number; insert: string }>;
  anchor: number;
  head: number;
}

/**
 * Wrap the selection in a mark (`**`, `*`, `~~`, `<u>`…), or take it off again when it is already wrapped.
 * An empty selection drops a pair of marks and puts the cursor between them.
 */
export function toggleWrap(doc: string, from: number, to: number, open: string, close = open): Edit {
  const before = doc.slice(Math.max(0, from - open.length), from);
  const after = doc.slice(to, to + close.length);
  // a single `*` next to `**` is part of a bold mark, not an italic one
  const partOfBold = open === "*" && (doc[from - 2] === "*" || doc[to + 1] === "*");
  if (before === open && after === close && !partOfBold) {
    return {
      changes: [{ from: from - open.length, to: from, insert: "" }, { from: to, to: to + close.length, insert: "" }],
      anchor: from - open.length,
      head: to - open.length,
    };
  }
  const inner = doc.slice(from, to);
  if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close) && !(open === "*" && inner.startsWith("**"))) {
    return { changes: [{ from, to, insert: inner.slice(open.length, inner.length - close.length) }], anchor: from, head: to - open.length - close.length };
  }
  return {
    changes: [{ from, insert: open }, { from: to, insert: close }],
    anchor: from + open.length,
    head: to + open.length,
  };
}

/** Put `prefix` at the start of a line, or remove it when it is already there. Another heading level is replaced. */
export function togglePrefix(line: string, prefix: string): string {
  const heading = /^#{1,6} /;
  if (line.startsWith(prefix)) return line.slice(prefix.length);
  if (prefix.startsWith("#")) return prefix + line.replace(heading, "");
  return prefix + line;
}

/** Take the Markdown and HTML marks off a piece of text: bold, italic, strike, highlight, underline, heading, quote and list prefixes. */
export function clearFormatting(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, ""))
    .join("\n")
    .replace(/<\/?u>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, "$1$2");
}

/** Where the cursor goes when a line is rewritten: the same distance from its end, so typing carries on after the new prefix. */
export function cursorAfter(line: { from: number; to: number }, next: string, head: number): number {
  return Math.max(line.from, line.from + next.length - Math.max(0, line.to - head));
}
