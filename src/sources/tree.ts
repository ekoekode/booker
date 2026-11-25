/** The contents of a reference library as a tree, a filter over its entries, and the way back from a search hit to an entry. Pure. */
import { fold } from "./index";
import { locatorOf, type NlibEntry } from "./nlib";

export interface Tree {
  roots: NlibEntry[];
  kids: Map<number, NlibEntry[]>;
  byId: Map<number, NlibEntry>;
}

export function buildTree(entries: NlibEntry[]): Tree {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const kids = new Map<number, NlibEntry[]>();
  const roots: NlibEntry[] = [];
  for (const e of entries) {
    if (e.parent !== null && byId.has(e.parent) && e.parent !== e.id) {
      const list = kids.get(e.parent) ?? [];
      list.push(e);
      kids.set(e.parent, list);
    } else roots.push(e);
  }
  return { roots, kids, byId };
}

/** What to print for an entry in a list. */
export const entryLabel = (e: NlibEntry): string => e.title || e.key || e.locator || `Entry ${e.id}`;

/** Entries whose title, key or locator contains every word typed, first `limit`. */
export function filterEntries(entries: NlibEntry[], q: string, limit = 200): NlibEntry[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return entries.slice(0, limit);
  const out: NlibEntry[] = [];
  for (const e of entries) {
    const hay = fold(`${e.title} ${e.key} ${e.locator}`);
    if (words.every((w) => hay.includes(w))) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The entry a search hit came from: chunk places are an entry's place, with " (2)" added to later pieces of a long one. */
export function entryForLoc(entries: NlibEntry[], loc: string): NlibEntry | undefined {
  const want = loc.replace(/ \(\d+\)$/, "");
  const byId = new Map(entries.map((e) => [e.id, e]));
  return entries.find((e) => locatorOf(e, byId) === want) ?? entries.find((e) => locatorOf(e, byId) === loc);
}
