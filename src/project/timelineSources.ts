/**
 * The timeline map's building blocks. A *source* is something you add to the map (a character, a place, a plotline, a life, a kind of
 * element). Each source gets a lane holding everything connected to it, overlaps are pushed to rows below by the view. Colours come from
 * rules you set. Pure data code.
 */
import type { TimelineItem } from "../analysis";

export type SourceKind = "character" | "location" | "plotline" | "life" | "kind" | "all";

export interface Source {
  kind: SourceKind;
  name: string;
  /** a colour you picked for this source */
  color?: string;
}

export const sourceKey = (s: Source) => `${s.kind}:${s.name}`;

export interface MapConfig {
  sources: Source[];
  /** one lane for every source, items coloured by source */
  merge: boolean;
  /** colour rules keyed "kind:scene", "character:Ann", "location:Fort Ash", "plotline:Romance", "life:Ann 2" or "item:<path>" */
  colors: Record<string, string>;
  /** kinds of element left out of the lanes (for example "act") */
  hidden: string[];
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  character: "Character",
  location: "Place",
  plotline: "Plotline",
  life: "Life",
  kind: "Kind",
  all: "Everything",
};

export function parseConfig(raw: unknown): MapConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const kinds: SourceKind[] = ["character", "location", "plotline", "life", "kind", "all"];
  const sources: Source[] = [];
  for (const s of Array.isArray(o.sources) ? o.sources : []) {
    if (!s || !kinds.includes(s.kind) || typeof s.name !== "string") continue;
    if (sources.some((x) => sourceKey(x) === sourceKey(s))) continue;
    sources.push({ kind: s.kind, name: s.name, ...(typeof s.color === "string" && s.color ? { color: s.color } : {}) });
  }
  const colors: Record<string, string> = {};
  if (o.colors && typeof o.colors === "object") for (const [k, v] of Object.entries(o.colors)) if (typeof v === "string" && v) colors[k] = v;
  const hidden = Array.isArray(o.hidden) ? o.hidden.filter((x: unknown) => typeof x === "string") : ["act"];
  return { sources, merge: o.merge === true, colors, hidden };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const has = (list: string[] | undefined, name: string) => (list ?? []).some((x) => same(x, name));

/** Is this item connected to the source? */
export function matches(s: Source, it: TimelineItem): boolean {
  switch (s.kind) {
    case "all":
      return true;
    case "kind":
      return same(it.kind, s.name);
    case "character":
      return has(it.characters, s.name);
    case "location":
      return has(it.locations, s.name);
    case "plotline":
      return has(it.plotlines, s.name);
    case "life":
      return has(it.lives, s.name);
  }
}

/** The colour of one item, or null for the default. A note's own `color` property beats everything but a per-item rule. */
export function itemColor(it: TimelineItem, cfg: MapConfig, source?: Source): string | null {
  const c = cfg.colors;
  if (c[`item:${it.path}`]) return c[`item:${it.path}`];
  if (it.color) return it.color;
  if (source?.color) return source.color;
  for (const n of it.lives ?? []) if (c[`life:${n}`]) return c[`life:${n}`];
  for (const n of it.characters) if (c[`character:${n}`]) return c[`character:${n}`];
  for (const n of it.locations) if (c[`location:${n}`]) return c[`location:${n}`];
  for (const n of it.plotlines) if (c[`plotline:${n}`]) return c[`plotline:${n}`];
  return c[`kind:${it.kind}`] ?? null;
}

export interface MapLane {
  key: string;
  source?: Source;
  items: TimelineItem[];
  /** colour per item, same order as items */
  colors: Array<string | null>;
}

/** One lane per source; with `merge`, a single lane of everything any source matches (each item once, coloured by the first source that matches). */
export function buildLanes(all: TimelineItem[], cfg: MapConfig): MapLane[] {
  const items = all.filter((i) => !cfg.hidden.includes(i.kind));
  const byStart = (a: TimelineItem, b: TimelineItem) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label);
  if (cfg.merge) {
    const seen = new Map<string, { it: TimelineItem; src: Source }>();
    for (const src of cfg.sources) for (const it of items) if (!seen.has(it.id) && matches(src, it)) seen.set(it.id, { it, src });
    const rows = [...seen.values()].sort((a, b) => byStart(a.it, b.it));
    return [{ key: "Selected", items: rows.map((r) => r.it), colors: rows.map((r) => itemColor(r.it, cfg, r.src)) }];
  }
  return cfg.sources.map((src) => {
    // a lane of everything (or of a kind, place or plotline) leaves lives out: they show in their character's lane
    const noLives = src.kind === "all" || (src.kind === "kind" && !same(src.name, "life")) || src.kind === "location" || src.kind === "plotline";
    const its = items.filter((it) => matches(src, it) && !(noLives && (it.kind === "life" || it.seq !== undefined) && !(src.kind === "kind" && same(src.name, it.kind)))).sort(byStart);
    return { key: src.name, source: src, items: its, colors: its.map((it) => itemColor(it, cfg, src)) };
  });
}

/** Everything you can add as a source, from what exists. `known` carries names that may not appear on any dated item yet. */
export function candidateSources(items: TimelineItem[], known: { characters: string[]; locations: string[]; lives: string[] }): Source[] {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const out: Source[] = [{ kind: "all", name: "Everything" }];
  for (const k of uniq(items.map((i) => i.kind))) out.push({ kind: "kind", name: k });
  for (const n of uniq([...known.characters, ...items.flatMap((i) => i.characters)])) out.push({ kind: "character", name: n });
  for (const n of uniq([...known.lives, ...items.flatMap((i) => i.lives ?? [])])) out.push({ kind: "life", name: n });
  for (const n of uniq([...known.locations, ...items.flatMap((i) => i.locations)])) out.push({ kind: "location", name: n });
  for (const n of uniq(items.flatMap((i) => i.plotlines))) out.push({ kind: "plotline", name: n });
  return out;
}

/**
 * Chapter and act spans worked out from dated scenes (they are not notes of their own). Each span covers its scenes and carries
 * the characters, places, plotlines and lives of those scenes, so a character's chapters show up with them.
 */
export function deriveSpans(scenes: TimelineItem[], names: { act: (a: string) => string; chapter: (c: string) => string }): TimelineItem[] {
  const groups = new Map<string, { kind: "act" | "chapter"; key: string; its: TimelineItem[] }>();
  for (const s of scenes) {
    if (s.kind !== "scene") continue;
    if (s.chapter) {
      const k = `chapter:${s.chapter}`;
      (groups.get(k) ?? groups.set(k, { kind: "chapter", key: s.chapter, its: [] }).get(k)!).its.push(s);
    }
    if (s.act) {
      const k = `act:${s.act}`;
      (groups.get(k) ?? groups.set(k, { kind: "act", key: s.act, its: [] }).get(k)!).its.push(s);
    }
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  return [...groups.entries()].map(([id, g]) => {
    const start = Math.min(...g.its.map((i) => i.start));
    const end = Math.max(...g.its.map((i) => i.end));
    return {
      id: `span:${id}`,
      path: g.its[0].path,
      kind: g.kind,
      label: g.kind === "act" ? names.act(g.key) : names.chapter(g.key),
      start,
      end: Math.max(end, start + 1e-6),
      approx: false,
      fuzz: 0,
      open: false,
      characters: uniq(g.its.flatMap((i) => i.characters)),
      plotlines: uniq(g.its.flatMap((i) => i.plotlines)),
      locations: uniq(g.its.flatMap((i) => i.locations)),
      lives: uniq(g.its.flatMap((i) => i.lives ?? [])),
      book: g.its[0].book,
      derived: true,
      detail: `${g.its.length} scene${g.its.length === 1 ? "" : "s"}`,
    };
  });
}

/** Black or white, whichever reads better on a background colour (`#rgb` or `#rrggbb`). */
export function textOn(hex: string): "#000000" | "#ffffff" {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "#ffffff";
  const lin = (i: number) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  // pick the side with the higher contrast ratio
  return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? "#000000" : "#ffffff";
}
