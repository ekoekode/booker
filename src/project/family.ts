/** Family trees: who is related to whom, worked out from each character's `parents` and `partners`. Pure, so it can be tested. */

export interface Person {
  name: string;
  parents: string[];
  partners: string[];
}

export interface TreeDef {
  id: string;
  name: string;
  members: string[];
}

export interface FamilyFile {
  trees: TreeDef[];
}

export const MAIN_TREE = "main";

export function parseFamily(raw: unknown): FamilyFile {
  const trees = Array.isArray((raw as any)?.trees) ? (raw as any).trees : [];
  return {
    trees: trees
      .filter((t: any) => t && typeof t.id === "string" && typeof t.name === "string")
      .map((t: any) => ({ id: t.id, name: t.name, members: Array.isArray(t.members) ? t.members.map(String) : [] })),
  };
}

export interface PlacedPerson {
  name: string;
  /** generation: 0 for the oldest, counted down the page */
  gen: number;
  /** column slot, left to right across the whole tree */
  slot: number;
}

export interface Layout {
  placed: PlacedPerson[];
  /** parent -> child links */
  descent: Array<{ parent: string; child: string }>;
  /** partner pairs, each once */
  couples: Array<[string, string]>;
  /** people with no links to anyone else in this tree */
  unconnected: string[];
  slots: number;
  gens: number;
}

/** Keep only the people named, and links between them; links are made two-way for partners. */
function restrict(people: Person[], members?: Set<string>): Person[] {
  const known = new Set(people.map((p) => p.name));
  const keep = (n: string) => known.has(n) && (!members || members.has(n));
  const out = new Map<string, Person>();
  for (const p of people) if (keep(p.name)) out.set(p.name, { name: p.name, parents: p.parents.filter(keep), partners: p.partners.filter(keep) });
  for (const p of [...out.values()]) for (const q of p.partners) if (!out.get(q)!.partners.includes(p.name)) out.get(q)!.partners.push(p.name);
  return [...out.values()];
}

export function layoutFamily(all: Person[], members?: string[]): Layout {
  const people = restrict(all, members ? new Set(members) : undefined);
  const by = new Map(people.map((p) => [p.name, p]));
  const linked = new Set<string>();
  for (const p of people) {
    if (p.parents.length || p.partners.length) linked.add(p.name);
    for (const q of [...p.parents, ...p.partners]) linked.add(q);
  }
  const unconnected = people.filter((p) => !linked.has(p.name)).map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const names = people.filter((p) => linked.has(p.name)).map((p) => p.name).sort((a, b) => a.localeCompare(b));

  // generations: below the deepest parent, and level with a partner
  const gen = new Map(names.map((n) => [n, 0]));
  for (let round = 0; round < names.length + 2; round++) {
    let changed = false;
    for (const n of names) {
      const p = by.get(n)!;
      let g = gen.get(n)!;
      for (const par of p.parents) g = Math.max(g, gen.get(par)! + 1);
      for (const q of p.partners) g = Math.max(g, gen.get(q)!);
      if (g !== gen.get(n) && g <= names.length) {
        gen.set(n, g);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // connected groups, biggest first
  const comp = new Map<string, number>();
  const groups: string[][] = [];
  for (const n of names) {
    if (comp.has(n)) continue;
    const id = groups.length;
    const stack = [n];
    const g: string[] = [];
    comp.set(n, id);
    while (stack.length) {
      const x = stack.pop()!;
      g.push(x);
      const p = by.get(x)!;
      const kids = people.filter((c) => c.parents.includes(x)).map((c) => c.name);
      for (const y of [...p.parents, ...p.partners, ...kids]) if (!comp.has(y)) (comp.set(y, id), stack.push(y));
    }
    groups.push(g);
  }
  groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  const placed: PlacedPerson[] = [];
  let slot = 0;
  let gens = 0;
  for (const g of groups) {
    const x = new Map<string, number>();
    const maxGen = Math.max(...g.map((n) => gen.get(n)!));
    let width = 0;
    for (let level = 0; level <= maxGen; level++) {
      const row = g.filter((n) => gen.get(n) === level);
      // partners sit together
      const clusters: string[][] = [];
      const seen = new Set<string>();
      for (const n of row.sort((a, b) => a.localeCompare(b))) {
        if (seen.has(n)) continue;
        const c = [n];
        seen.add(n);
        for (let i = 0; i < c.length; i++) for (const q of by.get(c[i])!.partners) if (!seen.has(q) && gen.get(q) === level && comp.get(q) === comp.get(n)) (seen.add(q), c.push(q));
        clusters.push(c);
      }
      const key = (c: string[]) => {
        const ks: number[] = [];
        for (const n of c) for (const par of by.get(n)!.parents) if (x.has(par)) ks.push(x.get(par)!);
        return ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : Infinity;
      };
      clusters.sort((a, b) => key(a) - key(b) || a[0].localeCompare(b[0]));
      let col = 0;
      // children of the same parents stay below them, so start from where the first keyed cluster wants to be
      for (const c of clusters) {
        const k = key(c);
        if (Number.isFinite(k)) col = Math.max(col, Math.round(k - (c.length - 1) / 2));
        for (const n of c) x.set(n, col++);
      }
      width = Math.max(width, col);
    }
    for (const n of g) placed.push({ name: n, gen: gen.get(n)!, slot: slot + x.get(n)! });
    slot += width + 1;
    gens = Math.max(gens, maxGen + 1);
  }

  const descent: Layout["descent"] = [];
  const couples: Layout["couples"] = [];
  for (const n of names) {
    const p = by.get(n)!;
    for (const par of p.parents) descent.push({ parent: par, child: n });
    for (const q of p.partners) if (n < q) couples.push([n, q]);
  }
  return { placed, descent, couples, unconnected, slots: Math.max(slot - 1, 0), gens };
}
