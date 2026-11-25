/** Moby Thesaurus II (Grady Ward, public domain) turned into thesaurus rows. Pure. */
import type { DictRow } from "./dictionaries";

/**
 * The file has one headword per line, then its synonyms, all comma separated: "abandon,desert,forsake,leave". A row's text is
 * the synonym list as "a, b, c" (the headword itself and repeats left out). Rows are sorted by headword.
 */
export function parseMoby(text: string): DictRow[] {
  const byWord = new Map<string, string[]>();
  for (const raw of text.split("\n")) {
    const parts = raw.replace(/\r$/, "").split(",");
    if (parts.length < 2) continue;
    const word = parts[0].trim().toLowerCase();
    if (!word) continue;
    const list = byWord.get(word) ?? [];
    const seen = new Set(list);
    for (const p of parts.slice(1)) {
      const s = p.trim();
      if (s && s.toLowerCase() !== word && !seen.has(s)) {
        seen.add(s);
        list.push(s);
      }
    }
    if (list.length) byWord.set(word, list);
  }
  return [...byWord].map(([word, list]) => ({ word, text: list.join(", ") })).sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
}
