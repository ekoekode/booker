/** Drop-down navigation for a database: the levels above an entry (Book, Chapter...) or, for a flat dictionary, Letter and Entry. Pure. */
import type { NlibEntry } from "./nlib";
import { entryLabel, type Tree } from "./tree";

export interface Option {
  /** the entry to read when this is chosen */
  target: number;
  text: string;
}

export interface Level {
  label: string;
  options: Option[];
  /** target of the selected option */
  selected: number;
}

/** The node itself when it has text, else the first entry under it that has. */
export function firstReadable(tree: Tree, e: NlibEntry): NlibEntry | undefined {
  const stack = [e];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.text.trim()) return n;
    const kids = tree.kids.get(n.id);
    if (kids) stack.unshift(...kids);
  }
  return undefined;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const letterOf = (e: NlibEntry): string => {
  const c = entryLabel(e).normalize("NFD").replace(/[^A-Za-z]/, "").charAt(0).toUpperCase();
  return c || "#";
};

/** True when a database is a flat list long enough to want Letter and Entry. */
export const isFlat = (tree: Tree, entries: NlibEntry[]): boolean => tree.roots.length === entries.length && entries.length > 40;

/** The levels to show above the reading pane for the entry being read; levels with a single choice are left out. */
export function levelChoices(entries: NlibEntry[], tree: Tree, current: NlibEntry | null): Level[] {
  if (!current) return [];
  if (isFlat(tree, entries)) {
    const l = letterOf(current);
    const first = new Map<string, NlibEntry>();
    for (const e of entries) if (!first.has(letterOf(e))) first.set(letterOf(e), e);
    const letters = [...first.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, e]) => ({ target: e.id, text: k }));
    const same = entries.filter((e) => letterOf(e) === l).slice(0, 500).map((e) => ({ target: e.id, text: entryLabel(e) }));
    return [
      { label: "Letter", options: letters, selected: first.get(l)?.id ?? current.id },
      { label: "Entry", options: same, selected: current.id },
    ];
  }
  const path: NlibEntry[] = [];
  for (let n: NlibEntry | undefined = current; n; n = n.parent !== null && n.parent !== n.id ? tree.byId.get(n.parent) : undefined) path.unshift(n);
  const out: Level[] = [];
  path.forEach((node, depth) => {
    const sibs = depth === 0 ? tree.roots : tree.kids.get(path[depth - 1].id) ?? [];
    if (sibs.length < 2) return;
    const options = sibs.map((s) => ({ s, t: firstReadable(tree, s) })).filter((x) => x.t).map((x) => ({ target: x.t!.id, text: entryLabel(x.s) }));
    if (options.length < 2) return;
    const mine = options.find((o) => firstReadable(tree, node)?.id === o.target) ?? options.find((o) => o.text === entryLabel(node));
    out.push({ label: cap(node.level || "Section"), options, selected: mine?.target ?? options[0].target });
  });
  return out;
}
