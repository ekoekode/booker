/**
 * Pure auto-link engine. Given text and a list of names (name -> link target),
 * find unlinked occurrences and say how to link them. Used by the editor
 * idle-linker and by the bulk "link names in this note/book" commands.
 */

import { delimitedRanges } from "./text";

export interface NameEntry {
  /** the text to look for (a title or an alias) */
  name: string;
  /** link target as it should appear inside [[ ]] (usually the note basename or path) */
  target: string;
  /** true when the name is the note's own title/basename (2-letter names are only allowed then) */
  own?: boolean;
  /** internal: an article-less single word ("Keep" from "The Keep") only links when capitalised */
  capOnly?: boolean;
}

/** Limits that keep a hostile or enormous codex from making the matcher huge. */
export const MAX_ALIASES_PER_NOTE = 40;
export const MAX_NAMES_PER_SERIES = 1500;

const STOPWORDS = new Set(
  "the and but for not you her his she him they was are with that this from have had has then than when what who how all any one out can may now our its off yes".split(" ")
);

/** Characters that would break or inject into a [[wikilink]] (or are not valid in a note name). */
const BAD_NAME_CHARS = /[\[\]|#^\n\r`]/;

/** Why a name must not be auto-linked, or null when it is acceptable. */
export function rejectName(name: string, own = false): string | null {
  const n = name.trim();
  if (BAD_NAME_CHARS.test(n)) return "characters";
  if (n.length < (own ? 2 : 3)) return "short";
  if (STOPWORDS.has(n.toLowerCase())) return "common";
  return null;
}

export interface Insertion {
  from: number;
  to: number;
  replacement: string;
}

export type LinkMode = "every" | "first";

interface Range {
  from: number;
  to: number;
}

/** Ranges in `text` we must never insert links into. */
export function protectedRanges(text: string): Range[] {
  const out: Range[] = [];
  // bodies exclude "[" and are length-bounded: a run of "[[" or "[a](" stays linear
  const patterns = [
    /\[\[[^\[\]]{0,500}\]\]/g, // wikilinks (also embeds)
    /`[^`\n]*`/g, // inline code
    /\[[^\[\]\n]{0,1000}\]\([^)\n\[]{0,2000}\)/g, // markdown links
    /https?:\/\/[^\s)]+/g, // bare urls
    /\$[^$\n]+\$/g, // inline math
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push({ from: m.index, to: m.index + m[0].length });
  }
  for (const [open, close] of [["%%", "%%"], ["<!--", "-->"]]) // obsidian and html comments
    for (const [a, b] of delimitedRanges(text, open, close)) out.push({ from: a, to: b });
  return out;
}

function inside(pos: number, end: number, ranges: Range[]): boolean {
  for (const r of ranges) if (pos < r.to && end > r.from) return true;
  return false;
}

const WORDCH = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORDCH.test(ch);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type MatchCase = "ignore" | "respect";

export interface Matcher {
  /** case-sensitive; in fold mode it holds the lower-cased names and runs on lower-cased text (fast) */
  re: RegExp;
  /** fold mode only: case-insensitive twin of `re`, used when lower-casing would change the text length */
  reI?: RegExp;
  /** keyed by the name as written ("respect") or lower-cased ("ignore") */
  byName: Map<string, NameEntry>;
  /** true when matching ignores capitalisation */
  fold: boolean;
  /** names dropped as unsafe, too short, too common or over the cap */
  ignored: number;
}

import { iesForm, pluralSuffixLength } from "./nameVariants";

const ARTICLE = /^(?:the|a|an)\s+(\S.*)$/i;

/**
 * Build the matcher. Matching is case-insensitive by default (`matchCase: "ignore"`), so
 * "ember keep" and "MARA" link. To keep that from creating noise (see `allowFolded`),
 * lowercase matches and 3-letter names are guarded when the case is ignored.
 * Names that start with an article ("The Ember Keep") also match without it ("Ember Keep").
 */
export function buildMatcher(entries: NameEntry[], opts: { matchCase?: MatchCase } = {}): Matcher | null {
  const fold = (opts.matchCase ?? "ignore") === "ignore";
  const key = (n: string) => (fold ? n.toLocaleLowerCase() : n);
  const byName = new Map<string, NameEntry>();
  let ignored = 0;
  const add = (n: string, e: NameEntry, derived: boolean) => {
    if (derived && !/\s/.test(n)) e = { ...e, capOnly: true };
    if (rejectName(n, !!e.own) || BAD_NAME_CHARS.test(e.target) || !e.target.trim()) {
      if (!derived) ignored++;
      return;
    }
    const k = key(n);
    if (byName.has(k)) return; // duplicates (also ones differing only by case) keep the first entry
    if (byName.size >= MAX_NAMES_PER_SERIES) {
      if (!derived) ignored++;
      return;
    }
    byName.set(k, { ...e, name: n });
  };
  for (const e of entries) {
    const n = e.name.trim();
    if (!n) continue;
    add(n, e, false);
  }
  // article-less variants come after every real name so they never shadow one
  for (const e of entries) {
    const am = ARTICLE.exec(e.name.trim());
    if (am) add(am[1].trim(), e, true);
  }
  // "Berry" also matches "Berries"; the other plurals are recognised after the match (see findInsertions)
  for (const e of entries) {
    const ies = iesForm(e.name);
    if (ies) add(ies, e, true);
  }
  if (byName.size === 0) return null;
  // longest first so "Aria Vale" wins over "Aria"
  const names = [...byName.values()].map((e) => e.name).sort((a, b) => b.length - a.length);
  const reI = fold ? new RegExp(names.map(escapeRe).join("|"), "giu") : undefined;
  // a case-insensitive alternation of many names is ~1000x slower in V8 than a case-sensitive one,
  // so in fold mode we search a lower-cased copy of the text with lower-cased names
  const re = new RegExp((fold ? names.map((n) => n.toLocaleLowerCase()) : names).map(escapeRe).join("|"), "gu");
  return { re, reI, byName, fold, ignored };
}

function isLowerFirst(s: string): boolean {
  const c = s.charAt(0);
  return c !== c.toLocaleUpperCase() && c === c.toLocaleLowerCase();
}

/**
 * Noise guard for case-insensitive matching (only applies when the case is ignored):
 * - a match typed with a lowercase first letter links only if the name is 4+ characters,
 *   or contains a space, or the user wrote the name in lowercase themselves (intentional);
 * - a single-word name of 3 letters links only when typed with exactly the same capitalisation.
 */
function allowFolded(shown: string, name: string): boolean {
  const spaced = /\s/.test(name);
  if (!spaced && [...name].length <= 3 && shown !== name) return false;
  if (isLowerFirst(shown) && !spaced && [...name].length < 4 && !isLowerFirst(name)) return false;
  return true;
}

export interface FindOptions {
  mode: LinkMode;
  /** link targets already linked elsewhere in the note (for "first" mode) */
  alreadyLinked?: Set<string>;
  /** do not link this target (the note itself) */
  selfTarget?: string;
  /** do not touch matches the cursor sits strictly inside (a word touching the cursor is complete once the idle pause has passed) */
  avoidFrom?: number;
  avoidTo?: number;
}

export function findInsertions(
  text: string,
  matcher: Matcher | null,
  opts: FindOptions
): Insertion[] {
  if (!matcher) return [];
  const prot = protectedRanges(text);
  const linkedNow = new Set([...(opts.alreadyLinked ?? [])].map((t) => t.toLocaleLowerCase())); // wikilinks ignore case
  const out: Insertion[] = [];
  let re = matcher.re;
  let hay = text;
  if (matcher.fold) {
    hay = text.toLocaleLowerCase();
    if (hay.length !== text.length) {
      re = matcher.reI!; // rare: lower-casing shifts offsets, fall back to the slow flag
      hay = text;
    }
  }
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) {
    const from = m.index;
    const to = from + m[0].length;
    if (isWordChar(text[from - 1])) continue; // inside a longer word
    // "Aria's" is fine (apostrophe ends the word); "Aria-Vale" hyphenated: treat as word
    if (text[to] === "-" && isWordChar(text[to + 1])) continue;
    if (text[from - 1] === "-" && isWordChar(text[from - 2])) continue;
    if (inside(from, to, prot)) continue;
    if (opts.avoidFrom !== undefined && opts.avoidTo !== undefined && from < opts.avoidTo && to > opts.avoidFrom) continue;
    const shown = text.slice(from, to);
    const entry = matcher.byName.get(matcher.fold ? shown.toLocaleLowerCase() : shown);
    if (!entry) continue;
    // a plural ("Christians") is still the name; any other letters after it make a longer word
    let end = to;
    if (isWordChar(text[to])) {
      const n = pluralSuffixLength(entry.name, text.slice(to));
      if (!n) continue;
      end = to + n;
    }
    if (matcher.fold && !allowFolded(shown, entry.name)) continue;
    if (entry.capOnly && isLowerFirst(shown)) continue;
    if (opts.selfTarget && entry.target === opts.selfTarget) continue;
    if (opts.mode === "first" && linkedNow.has(entry.target.toLocaleLowerCase())) continue;
    const written = text.slice(from, end);
    const replacement = written === entry.target ? `[[${entry.target}]]` : `[[${entry.target}|${written}]]`;
    out.push({ from, to: end, replacement });
    linkedNow.add(entry.target.toLocaleLowerCase());
  }
  return out;
}

export function applyInsertions(text: string, ins: Insertion[]): string {
  let out = text;
  for (const i of [...ins].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, i.from) + i.replacement + out.slice(i.to);
  }
  return out;
}

/** Collect link targets already present in text (for first-mention mode). */
export function existingTargets(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\[\[([^\[\]|#]{1,500})(?:#[^\[\]|]{0,500})?(?:\|[^\[\]]{0,500})?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1].trim());
  return out;
}

/**
 * Whole-document linking, aware of YAML frontmatter and fenced code blocks.
 * Used by bulk commands. Frontmatter and code fences are left untouched.
 */
export function linkDocument(
  doc: string,
  matcher: Matcher | null,
  opts: { mode: LinkMode; selfTarget?: string }
): string {
  if (!matcher) return doc;
  const lines = doc.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  const already = existingTargets(doc);
  let fence = false;
  const out: string[] = lines.slice(0, i);
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      out.push(line);
      continue;
    }
    if (fence || /^#{1,6}\s/.test(line)) {
      out.push(line);
      continue;
    }
    const ins = findInsertions(line, matcher, { mode: opts.mode, alreadyLinked: already, selfTarget: opts.selfTarget });
    for (const x of ins) {
      const t = /\[\[([^\]|]+)/.exec(x.replacement);
      if (t) already.add(t[1]);
    }
    out.push(applyInsertions(line, ins));
  }
  return out.join("\n");
}
