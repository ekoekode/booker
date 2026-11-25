/**
 * Decides how each line of a scene is typeset in the editor. Pure: the editor extension only maps these results to CSS classes,
 * so the Markdown text itself is never changed by formatting.
 */
export interface LineInfo {
  /** skip: properties, code, headings, quotes, lists, tables, scene breaks. blank: empty line. text: prose. */
  kind: "skip" | "blank" | "text";
  /** the line opens with a quotation mark or a dash */
  dialogue: boolean;
  /** first prose line after the start, a heading or a scene break */
  first: boolean;
}

const SCENE_BREAK = /^\s*([*\-_~#]\s*){3,}$/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const DIALOGUE = /^[\s  ]*["“”«„'‘—–]/;
const NOT_PROSE = [/^\s*>/, /^\s*([-*+]|\d+[.)])\s/, /^\s*\|/, /^\s*<[^>]*>\s*$/, /^\s*!?\[\[/];

const SKIP: LineInfo = { kind: "skip", dialogue: false, first: false };
const BLANK: LineInfo = { kind: "blank", dialogue: false, first: false };

const isBreak = (s: string) => HEADING.test(s) || SCENE_BREAK.test(s);

/** Walk a document's lines and describe each one. Properties and code fences are tracked as state. */
export function classifyLines(lines: string[]): LineInfo[] {
  const out: LineInfo[] = [];
  let inFm = lines[0]?.trim() === "---";
  let inCode = false;
  // true until the first prose line, and again after every heading or scene break
  let first = true;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (inFm) {
      out.push(SKIP);
      if (i > 0 && t.trim() === "---") inFm = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(t)) {
      inCode = !inCode;
      out.push(SKIP);
      continue;
    }
    if (inCode) {
      out.push(SKIP);
      continue;
    }
    if (t.trim() === "") {
      out.push(BLANK);
      continue;
    }
    if (isBreak(t)) {
      first = true;
      out.push(SKIP);
      continue;
    }
    if (NOT_PROSE.some((r) => r.test(t))) {
      out.push(SKIP);
      continue;
    }
    out.push({ kind: "text", dialogue: DIALOGUE.test(t), first });
    first = false;
  }
  return out;
}

export const EM_SPACE = " ";

/** Add one em space at the start of a paragraph (the "manual indent"). */
export function indentLine(line: string): string {
  return EM_SPACE + line;
}

/** Remove one level of indent: an em space, a tab, or up to four spaces. */
export function outdentLine(line: string): string {
  if (line.startsWith(EM_SPACE) || line.startsWith("\t")) return line.slice(1);
  return line.replace(/^ {1,4}/, "");
}
