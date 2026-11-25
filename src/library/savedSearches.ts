/** Searches kept by name, in groups that nest like folders ("Grace/Early church"). Pure. */
import { asStr, newId } from "./jsonStore";
import type { SearchMode } from "../sources/fuzzy";
import type { Scope } from "../reader/searchOptions";

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  scope: Scope;
  mode: SearchMode;
  /** "" for the top level; "A/B" for a group inside a group */
  group: string;
}

export interface SavedSearches {
  searches: SavedSearch[];
  /** groups with nothing in them yet */
  groups: string[];
}

export const emptySaved = (): SavedSearches => ({ searches: [], groups: [] });

const SCOPES = ["page", "work", "database", "library", "all", "docs"];
const MODES = ["exact", "fuzzy", "semantic"];

/** A group path with stray slashes and spaces removed. */
export const cleanGroup = (g: string): string => g.split("/").map((p) => p.trim()).filter(Boolean).join("/");

export function parseSaved(raw: unknown): SavedSearches {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const searches: SavedSearch[] = [];
  if (Array.isArray(o.searches))
    for (const r of o.searches) {
      if (!r || typeof r !== "object") continue;
      const s = r as Record<string, unknown>;
      const query = asStr(s.query).trim();
      if (!query) continue;
      searches.push({ id: asStr(s.id) || newId(), name: asStr(s.name).trim() || query, query, scope: (SCOPES.includes(asStr(s.scope)) ? s.scope : "all") as Scope, mode: (MODES.includes(asStr(s.mode)) ? s.mode : "exact") as SearchMode, group: cleanGroup(asStr(s.group)) });
    }
  const groups = Array.isArray(o.groups) ? [...new Set(o.groups.filter((g): g is string => typeof g === "string").map(cleanGroup).filter(Boolean))] : [];
  return { searches, groups };
}

/** Saves a search. The same query, scope and mode in the same group is renamed rather than repeated. */
export function addSaved(s: SavedSearches, n: Omit<SavedSearch, "id">): SavedSearches {
  const group = cleanGroup(n.group);
  const same = s.searches.find((x) => x.query === n.query && x.scope === n.scope && x.mode === n.mode && x.group === group);
  if (same) return { ...s, searches: s.searches.map((x) => (x === same ? { ...x, name: n.name } : x)) };
  return { ...s, searches: [...s.searches, { ...n, group, id: newId() }] };
}

export const removeSaved = (s: SavedSearches, id: string): SavedSearches => ({ ...s, searches: s.searches.filter((x) => x.id !== id) });

export const moveSaved = (s: SavedSearches, id: string, group: string): SavedSearches => ({ ...s, searches: s.searches.map((x) => (x.id === id ? { ...x, group: cleanGroup(group) } : x)) });

export const addGroup = (s: SavedSearches, group: string): SavedSearches => {
  const g = cleanGroup(group);
  return g && !s.groups.includes(g) ? { ...s, groups: [...s.groups, g] } : s;
};

/** Renames a group and everything inside it. */
export function renameGroup(s: SavedSearches, from: string, to: string): SavedSearches {
  const a = cleanGroup(from);
  const b = cleanGroup(to);
  if (!a || a === b) return s;
  const re = (g: string) => (g === a ? b : g.startsWith(`${a}/`) ? b + g.slice(a.length) : g);
  return { searches: s.searches.map((x) => ({ ...x, group: re(x.group) })), groups: [...new Set(s.groups.map(re))] };
}

/** Deletes a group; what was inside moves up to the group above. */
export function removeGroup(s: SavedSearches, group: string): SavedSearches {
  const g = cleanGroup(group);
  if (!g) return s;
  const up = g.includes("/") ? g.slice(0, g.lastIndexOf("/")) : "";
  const re = (x: string) => (x === g ? up : x.startsWith(`${g}/`) ? (up ? `${up}/` : "") + x.slice(g.length + 1) : x);
  return { searches: s.searches.map((x) => ({ ...x, group: re(x.group) })), groups: [...new Set(s.groups.filter((x) => x !== g).map(re).filter(Boolean))] };
}

export interface GroupNode {
  name: string;
  path: string;
  children: GroupNode[];
  searches: SavedSearch[];
}

/** The groups as a tree, with the ungrouped searches at the root. Groups with no searches still show. */
export function groupTree(s: SavedSearches): GroupNode {
  const root: GroupNode = { name: "", path: "", children: [], searches: [] };
  const find = (path: string): GroupNode => {
    let at = root;
    let built = "";
    for (const part of path.split("/").filter(Boolean)) {
      built = built ? `${built}/${part}` : part;
      let next = at.children.find((c) => c.name === part);
      if (!next) at.children.push((next = { name: part, path: built, children: [], searches: [] }));
      at = next;
    }
    return at;
  };
  for (const g of s.groups) find(g);
  for (const x of s.searches) find(x.group).searches.push(x);
  const sort = (n: GroupNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}
