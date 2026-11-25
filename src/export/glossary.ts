/** A glossary written as "Term: definition" lines, printed A to Z with the term in bold. Pure. */

const ENTRY = /^\s*(?:[-*+]\s+)?\**([^:*—–\n]{1,80}?)\**\s*(?::|—|–| - )\s*(.+)$/;

/** The sorted glossary, or null when the text does not look like one (fewer than two entries). */
export function sortGlossary(text: string): string | null {
  const entries: { term: string; def: string }[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const m = ENTRY.exec(raw);
    if (m && !/^\s{2,}/.test(raw)) entries.push({ term: m[1].trim(), def: m[2].trim() });
    else if (entries.length) entries[entries.length - 1].def += ` ${raw.trim()}`;
    else return null;
  }
  if (entries.length < 2) return null;
  entries.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
  return entries.map((e) => `**${e.term}.** ${e.def}`).join("\n\n");
}
