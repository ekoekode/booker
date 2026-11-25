/** Inline formatting tags in text from documents and databases (<sup>, <i>, <b>…): applied as formatting, never shown as tags. */

export interface Piece {
  text: string;
  /** the formatting tags in force for this text, outermost first */
  tags: string[];
}

const ALIAS: Record<string, string> = { em: "i", strong: "b", strike: "s", del: "s", ins: "u" };
const KEEP = new Set(["sup", "sub", "i", "b", "u", "s", "mark", "code", "small"]);
const BREAKS = new Set(["br", "p", "div", "li", "tr"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Split text into pieces, each with the formatting tags that apply. Tags without formatting meaning are dropped; line-ending ones become a space. Pure. */
export function inlinePieces(source: string): Piece[] {
  // a snippet can be cut in the middle of a tag
  const raw = source.replace(/<\/?[a-z][^>]*$/i, "");
  const out: Piece[] = [];
  const open: string[] = [];
  const re = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
  const push = (text: string) => {
    const t = decodeEntities(text);
    if (t) out.push({ text: t, tags: [...open] });
  };
  let last = 0;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    push(raw.slice(last, m.index));
    last = m.index + m[0].length;
    const name = ALIAS[m[2].toLowerCase()] ?? m[2].toLowerCase();
    if (BREAKS.has(name)) {
      push(" ");
    } else if (KEEP.has(name)) {
      if (m[1]) {
        const i = open.lastIndexOf(name);
        if (i >= 0) open.splice(i, 1);
      } else if (!m[3]) open.push(name);
    }
  }
  push(raw.slice(last));
  return out;
}

/** Draw text with its inline tags as real formatting. */
export function renderInline(parent: HTMLElement, raw: string) {
  for (const piece of inlinePieces(raw)) {
    let at: HTMLElement = parent;
    for (const t of piece.tags) at = at.createEl(t as keyof HTMLElementTagNameMap);
    at.appendText(piece.text);
  }
}
