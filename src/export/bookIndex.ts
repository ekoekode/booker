/** The back-of-book index: terms listed in the project note, each with the chapters it appears in. Pure. */

export interface IndexSource {
  where: string;
  text: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Read the terms from a project note's `indexTerms` property: a list, or one line of comma-separated words. */
export function indexTerms(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const term = String(t ?? "").trim();
    if (term && !seen.has(term.toLowerCase())) {
      seen.add(term.toLowerCase());
      out.push(term);
    }
  }
  return out;
}

/** An entry in `indexTerms` may list other spellings after a bar: "Jerusalem|Zion|City of David". The first is what is printed. */
export function termNames(entry: string): string[] {
  return entry.split("|").map((n) => n.trim()).filter(Boolean);
}

/** Each term that occurs (whole words, any case, under any of its spellings) with the places it was found in reading order; sorted A to Z, terms not found left out. */
export function buildIndex(terms: string[], sources: IndexSource[]): { term: string; where: string[] }[] {
  const out: { term: string; where: string[] }[] = [];
  for (const entry of terms) {
    const names = termNames(entry);
    if (!names.length) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu");
    const where: string[] = [];
    for (const s of sources) if (re.test(s.text) && !where.includes(s.where)) where.push(s.where);
    if (where.length) out.push({ term: names[0], where });
  }
  return out.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Print a different name for an entry; the old name keeps matching in the text. */
export function renameTerm(terms: string[], entry: string, label: string): string[] {
  const name = label.trim();
  if (!name || name.includes("|")) return terms;
  return terms.map((t) => (t === entry ? [name, ...termNames(t).filter((n) => !same(n, name))].join("|") : t));
}

/** Fold `from` into `into`: its spellings count as the same entry, and the entry `from` goes away. */
export function mergeTerms(terms: string[], from: string, into: string): string[] {
  if (from === into) return terms;
  const extra = termNames(from);
  return terms
    .filter((t) => t !== from)
    .map((t) => (t === into ? [...termNames(t), ...extra.filter((n) => !termNames(t).some((m) => same(m, n)))].join("|") : t));
}

export const removeTerm = (terms: string[], entry: string): string[] => terms.filter((t) => t !== entry);
