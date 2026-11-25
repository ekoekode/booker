/** What a search looks in, from where the reader is. Pure. */
import type { Place } from "./place";
import { databaseOf } from "../sources/catalog";
import type { Source } from "../sources/types";
import { matchWord, type SearchMode } from "../sources/fuzzy";
import { fold } from "../sources/index";

export type { SearchMode };

export type Scope = "page" | "work" | "database" | "library" | "all" | "docs" | "writing";

export const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: "page", label: "Current page" },
  { id: "work", label: "Current work" },
  { id: "database", label: "Current database" },
  { id: "library", label: "Library" },
  { id: "all", label: "Everything" },
  { id: "docs", label: "Documents" },
  { id: "writing", label: "My writing" },
];

export const MODES: Array<{ id: SearchMode; label: string }> = [
  { id: "exact", label: "Exact" },
  { id: "fuzzy", label: "Fuzzy" },
  { id: "semantic", label: "Semantic" },
];

/** The id the reader's shelf uses for the commentaries database. */
export const COMMENTARIES_DB = "@commentaries";

export interface Targets {
  /** which Bibles to search: none, the one open, or every one */
  bibles: "none" | "current" | "every";
  sources: Source[];
  /** also search the notes of your own projects */
  writing?: boolean;
}

/** What to search for a scope and the place the reader is at. "page" is searched in the page itself, so it has no targets here. */
export function scopeTargets(scope: Scope, place: Place, all: Source[]): Targets {
  const library = all;
  const inDb = (db: string) => all.filter((s) => databaseOf(s) === db);
  switch (scope) {
    case "page":
      return { bibles: "none", sources: [] };
    case "writing":
      return { bibles: "none", sources: [], writing: true };
    case "docs":
      return { bibles: "none", sources: all.filter((s) => s.kind !== "db") };
    case "library":
      return { bibles: "none", sources: library };
    case "all":
      return { bibles: "current", sources: all, writing: true };
    case "work":
      if (place.kind === "bible") return { bibles: "current", sources: [] };
      if (place.kind === "work") return { bibles: "none", sources: all.filter((s) => s.uid === place.uid) };
      if (place.kind === "works" && place.db !== COMMENTARIES_DB) return { bibles: "none", sources: inDb(place.db) };
      return { bibles: "none", sources: library };
    case "database":
      if (place.kind === "bible") return { bibles: "every", sources: [] };
      if (place.kind === "work") {
        const here = all.find((s) => s.uid === place.uid);
        return { bibles: "none", sources: here ? inDb(databaseOf(here)) : [] };
      }
      if (place.kind === "works" && place.db !== COMMENTARIES_DB) return { bibles: "none", sources: inDb(place.db) };
      return { bibles: "none", sources: library };
  }
}

/** Words to highlight on a page for a query: its words and quoted phrases, folded. */
export function highlightTerms(query: string): string[] {
  const out: string[] = [];
  const rest = query.replace(/"([^"]+)"/g, (_, p: string) => {
    out.push(p.trim());
    return " ";
  });
  for (const w of rest.split(/\s+/)) if (w && !w.startsWith("-")) out.push(w);
  return out.filter(Boolean);
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
const plain = (s: string) => fold(s).replace(/['’]/g, "");

/** The stretches of `text` to colour for a query: whole words that contain a term (exact) or have a form of it (fuzzy). */
export function findRanges(text: string, terms: string[], mode: SearchMode = "exact"): Array<[number, number]> {
  const want = terms.flatMap((t) => plain(t).split(/\s+/)).filter(Boolean);
  if (!want.length) return [];
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(WORD)) {
    const w = plain(m[0]);
    const hit = want.some((t) => (mode === "fuzzy" ? matchWord(w, t) !== null : w.includes(t)));
    if (hit && m.index !== undefined) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}
