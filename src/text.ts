/** Pure text helpers. No Obsidian imports, so they are unit-testable. */

export function splitFrontmatter(text: string): { fm: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: null, body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

/** Ranges [from,to) of open...close spans, found in linear time (an unclosed opener ends the scan). */
export function delimitedRanges(text: string, open: string, close: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    const a = text.indexOf(open, i);
    if (a < 0) break;
    const b = text.indexOf(close, a + open.length);
    if (b < 0) break; // no closer anywhere after: no later opener can close either
    out.push([a, b + close.length]);
    i = b + close.length;
  }
  return out;
}

function removeDelimited(text: string, open: string, close: string): string {
  const r = delimitedRanges(text, open, close);
  if (!r.length) return text;
  let out = "";
  let last = 0;
  for (const [a, b] of r) {
    out += text.slice(last, a);
    last = b;
  }
  return out + text.slice(last);
}

export function stripComments(text: string): string {
  return removeDelimited(removeDelimited(text, "%%", "%%"), "<!--", "-->");
}

/**
 * [[Target|Shown]] -> Shown, [[Target]] -> Target, [t](url) -> t, ![[embed]] removed.
 * Patterns exclude "[" from their bodies and are length-bounded so a hostile
 * run of "[[" or "[a](" cannot cause quadratic backtracking.
 */
export function stripLinks(text: string): string {
  return text
    .replace(/!\[\[[^\[\]]{0,500}\]\]/g, "")
    .replace(/\[\[([^\[\]|]{0,500})\|([^\[\]]{0,500})\]\]/g, "$2")
    .replace(/\[\[([^\[\]#|]{0,500})(?:#[^\[\]|]{0,500})?\]\]/g, "$1")
    .replace(/!\[[^\[\]]{0,1000}\]\([^)\[]{0,2000}\)/g, "")
    .replace(/\[([^\[\]]{0,1000})\]\([^)\[]{0,2000}\)/g, "$1");
}

/**
 * Remove characters that are illegal in XML 1.0 (control characters, U+FFFE/U+FFFF)
 * and lone surrogates. Used for everything that ends up in ePub/Word/PDF output.
 */
export function cleanXml(s: string): string {
  if (!s) return s;
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

export function proseOf(text: string): string {
  return stripLinks(stripComments(splitFrontmatter(text).body));
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function countWords(text: string): number {
  const prose = proseOf(text)
    .replace(/^#{1,6}\s+.*$/gm, "") // headings are not manuscript words
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ""); // scene break rules
  const m = prose.match(WORD);
  return m ? m.length : 0;
}

/** Leading numeric prefix like "03 " or "03- " */
export function numericPrefix(name: string): number | null {
  const m = /^(\d+)[\s._-]/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

export function stripPrefix(name: string): string {
  return name.replace(/^\d+[\s._-]+/, "");
}

export function pad2(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Make a filename safe for Obsidian on every platform. Returns "" when nothing
 * usable is left (empty, or a Windows reserved device name): callers must refuse that.
 */
export function safeName(name: string): string {
  const out = name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .replace(/[. ]+$/, "");
  if (RESERVED.test(out.split(".")[0].trim())) return "";
  return out;
}

/** Natural compare: "2 x" < "10 x" */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Extract link targets from a frontmatter value: "[[A|b]]", ["[[A]]", "B"], etc. */
export function linkTargets(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(visit);
    const s = String(v).trim();
    if (!s) return;
    const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = re.exec(s))) {
      out.push(m[1].trim());
      found = true;
    }
    if (!found) out.push(s);
  };
  visit(value);
  return out;
}

export function asList(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}
