/** Aliases of Codex notes: finding the real name for a nickname typed in a scene, and spotting two notes that share one. */

export interface AliasEntry {
  path: string;
  name: string;
  aliases: string[];
  /** the category the note is in, such as characters */
  kind: string;
}

export interface AliasHit {
  from: number;
  to: number;
  alias: string;
  name: string;
}

import { pluralSuffixLength } from "../nameVariants";

const norm = (s: string) => s.trim().toLowerCase();

/** The other note that already goes by this name or alias, or null. */
export function duplicateOf(entries: AliasEntry[], self: { path: string; name: string; kind: string }, alias: string): AliasEntry | null {
  const a = norm(alias);
  if (!a) return null;
  return entries.find((e) => e.path !== self.path && e.kind === self.kind && (norm(e.name) === a || e.aliases.some((x) => norm(x) === a))) ?? null;
}

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** The alias the cursor is in or just after, and who it stands for. `atEnd` insists the cursor is right after it (typing). */
export function aliasAt(entries: AliasEntry[], line: string, ch: number, atEnd = false): AliasHit | null {
  const pairs: { alias: string; name: string }[] = [];
  for (const e of entries) for (const a of e.aliases) if (a.trim().length >= 2 && norm(a) !== norm(e.name)) pairs.push({ alias: a.trim(), name: e.name });
  pairs.sort((x, y) => y.alias.length - x.alias.length);
  const low = line.toLowerCase();
  for (const p of pairs) {
    const needle = p.alias.toLowerCase();
    for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + 1)) {
      const to = i + needle.length;
      if (isWord(line[i - 1])) continue;
      // "Potatoes" is the alias in the plural: the name is then offered in the plural too
      const more = isWord(line[to]) ? pluralSuffixLength(p.alias, line.slice(to)) : 0;
      if (isWord(line[to]) && !more) continue;
      const end = to + more;
      if (atEnd ? ch !== end : ch < i || ch > end) continue;
      return { from: i, to: end, alias: line.slice(i, end), name: p.name + line.slice(to, end) };
    }
  }
  return null;
}
