/**
 * Plotlines: a plotline is a tag on a scene. System/plotlines.json only adds colours and notes to those tags.
 * Pure data code for the subway map; unknown keys in the file are kept so other tools can still read what Booker saves.
 */
/** How a plotline came to be: a branch leaves its parent and the parent carries on; a split ends the parent at that scene. */
export type RelationKind = "branch" | "split";

export interface Relation {
  /** the plotline it grows out of */
  parent: string;
  /** the scene (path) where it begins */
  at: string;
  kind: RelationKind;
}

/** A plotline joining another at a scene: `from` runs into `to` there. */
export interface Join {
  from: string;
  to: string;
  at: string;
}

export interface PlotlineFile {
  tagColors: Record<string, string>;
  tagTypeOverrides: Record<string, unknown>;
  plotlineDescriptions: Record<string, string>;
  /** Booker's own: how plotlines branch from each other (child tag -> relation) */
  relations: Record<string, Relation>;
  /** Booker's own: plotlines that run into another */
  joins: Join[];
  [k: string]: unknown;
}

export const PALETTE = ["#e5484d", "#3e63dd", "#30a46c", "#f5a524", "#8e4ec6", "#12a594", "#d6409f", "#978365", "#0090ff", "#ff7a2f"];

export function parsePlotlines(raw: unknown): PlotlineFile {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
  const relations: Record<string, Relation> = {};
  for (const [child, r] of Object.entries(obj(o.relations))) {
    if (r && typeof r.parent === "string" && typeof r.at === "string" && child !== r.parent) relations[child] = { parent: r.parent, at: r.at, kind: r.kind === "split" ? "split" : "branch" };
  }
  const joins: Join[] = Array.isArray(o.joins) ? o.joins.filter((j: any) => j && typeof j.from === "string" && typeof j.to === "string" && typeof j.at === "string" && j.from !== j.to).map((j: any) => ({ from: j.from, to: j.to, at: j.at })) : [];
  return { ...o, tagColors: { ...obj(o.tagColors) }, tagTypeOverrides: { ...obj(o.tagTypeOverrides) }, plotlineDescriptions: { ...obj(o.plotlineDescriptions) }, relations, joins };
}

/** Tags as plain names: no leading #, no blanks, no repeats. Accepts an array or a comma list. */
export function normTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  for (const t of list) {
    const s = String(t).trim().replace(/^#/, "");
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function toggleTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/**
 * What a scene is to a plotline. "scene" is a plain station; "setup" and "payoff" are Booker's own marks, kept on the
 * scene as `plotline_setup` and `plotline_payoff` (lists of plotline names). A mark always implies the plotline tag.
 */
export type Mark = "off" | "scene" | "setup" | "payoff";

export const MARK_CYCLE: Mark[] = ["off", "scene", "setup", "payoff"];

export function markOf(tags: string[], setup: string[], payoff: string[], tag: string): Mark {
  if (setup.includes(tag) && tags.includes(tag)) return "setup";
  if (payoff.includes(tag) && tags.includes(tag)) return "payoff";
  return tags.includes(tag) ? "scene" : "off";
}

export function nextMark(m: Mark): Mark {
  return MARK_CYCLE[(MARK_CYCLE.indexOf(m) + 1) % MARK_CYCLE.length];
}

export interface Marks {
  tags: string[];
  setup: string[];
  payoff: string[];
}

/** The scene's lists with one plotline set to `mark`. Other plotlines are left alone. */
export function withMark(cur: Marks, tag: string, mark: Mark): Marks {
  const without = (l: string[]) => l.filter((t) => t !== tag);
  const tags = mark === "off" ? without(cur.tags) : cur.tags.includes(tag) ? cur.tags : [...cur.tags, tag];
  return { tags, setup: mark === "setup" ? [...without(cur.setup), tag] : without(cur.setup), payoff: mark === "payoff" ? [...without(cur.payoff), tag] : without(cur.payoff) };
}

export interface MapScene {
  path: string;
  tags: string[];
}

export interface Line {
  tag: string;
  color: string;
  /** indexes into the scene list where this line has a station */
  stops: number[];
}

export interface SubwayMap {
  lines: Line[];
  /** for each scene, the lowest and highest lane it touches (an interchange spans several), or null */
  spans: Array<{ lo: number; hi: number; lanes: number[] } | null>;
}

/** Lanes in order of first appearance. Colours come from the file, else the palette by lane. */
export function buildMap(scenes: MapScene[], colors: Record<string, string>, extra: string[] = [], order?: string[]): SubwayMap {
  const lines: Line[] = [];
  const byTag = new Map<string, Line>();
  const line = (tag: string) => {
    let l = byTag.get(tag);
    if (!l) {
      l = { tag, color: colors[tag] || PALETTE[lines.length % PALETTE.length], stops: [] };
      byTag.set(tag, l);
      lines.push(l);
    }
    return l;
  };
  scenes.forEach((s, i) => s.tags.forEach((t) => line(t).stops.push(i)));
  // plotlines with no scenes yet (just created) still get a lane
  for (const t of extra) line(t);
  // a given lane order (children under their parents) puts those lanes first, in that order; the rest follow
  if (order) {
    const rank = (l: Line) => {
      const i = order.indexOf(l.tag);
      return i < 0 ? order.length + lines.indexOf(l) : i;
    };
    lines.sort((a, b) => rank(a) - rank(b));
  }
  const spans = scenes.map((s) => {
    const lanes = s.tags.map((t) => lines.indexOf(byTag.get(t)!)).sort((a, b) => a - b);
    return lanes.length ? { lo: lanes[0], hi: lanes[lanes.length - 1], lanes } : null;
  });
  return { lines, spans };
}

export interface Run {
  key: string;
  /** first and last index of consecutive items sharing the key */
  from: number;
  to: number;
}

/** Consecutive items with the same key as runs: the chapter and book bands over the map's columns. */
export function runs<T>(items: T[], keyOf: (t: T) => string): Run[] {
  const out: Run[] = [];
  items.forEach((t, i) => {
    const k = keyOf(t);
    const last = out[out.length - 1];
    if (last && last.key === k) last.to = i;
    else out.push({ key: k, from: i, to: i });
  });
  return out;
}

// ------------------------------------------------------------- branching plotlines

/** True when making `child` grow out of `parent` would make a loop. */
export function wouldLoop(relations: Record<string, Relation>, child: string, parent: string): boolean {
  let cur: string | undefined = parent;
  for (let n = 0; cur && n < 1000; n++) {
    if (cur === child) return true;
    cur = relations[cur]?.parent;
  }
  return false;
}

export interface LaneSlot {
  tag: string;
  /** how many parents it hangs under */
  depth: number;
  /** has subplots */
  parent: boolean;
}

/**
 * Plotline names in lane order with each subplot directly under its parent. Plotlines are kept in the order given
 * otherwise. `hidden` parents have their subplots left out.
 */
export function laneOrder(tags: string[], relations: Record<string, Relation>, hidden: Set<string> = new Set()): LaneSlot[] {
  const known = new Set(tags);
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const t of tags) {
    const r = relations[t];
    if (r && known.has(r.parent) && !wouldLoop(relations, t, r.parent)) kids.set(r.parent, [...(kids.get(r.parent) ?? []), t]);
    else roots.push(t);
  }
  const out: LaneSlot[] = [];
  const walk = (t: string, depth: number) => {
    out.push({ tag: t, depth, parent: (kids.get(t) ?? []).length > 0 });
    if (hidden.has(t)) return;
    for (const c of kids.get(t) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

/** The file with a new plotline growing out of `parent` at a scene. */
export function branchFrom(f: PlotlineFile, parent: string, child: string, at: string, kind: RelationKind, color: string): PlotlineFile {
  if (!child || child === parent || child in f.relations || wouldLoop(f.relations, child, parent)) return f;
  return { ...f, tagColors: { ...f.tagColors, [child]: f.tagColors[child] ?? color }, relations: { ...f.relations, [child]: { parent, at, kind } } };
}

/** The file with a plotline running into another at a scene. */
export function joinLines(f: PlotlineFile, from: string, to: string, at: string): PlotlineFile {
  if (from === to || f.joins.some((j) => j.from === from && j.to === to && j.at === at)) return f;
  return { ...f, joins: [...f.joins, { from, to, at }] };
}

/** The file without a plotline: its subplots are cut loose (they stay as plotlines of their own) and its joins go. */
export function dropLine(f: PlotlineFile, tag: string): PlotlineFile {
  const relations: Record<string, Relation> = {};
  for (const [c, r] of Object.entries(f.relations)) if (c !== tag && r.parent !== tag) relations[c] = r;
  const { [tag]: _c, ...colors } = f.tagColors;
  const { [tag]: _d, ...desc } = f.plotlineDescriptions;
  return { ...f, tagColors: colors, plotlineDescriptions: desc, relations, joins: f.joins.filter((j) => j.from !== tag && j.to !== tag) };
}

export interface Connector {
  /** lane indexes */
  fromLane: number;
  toLane: number;
  /** scene columns */
  fromAt: number;
  toAt: number;
  kind: RelationKind | "join";
  color: string;
}

/**
 * The curves between lanes: a branch or split leaves its parent at the scene where it begins and arrives at the
 * subplot's first station; a join leaves `from` at its last station on or before the scene and arrives at `to` there.
 */
export function connectors(map: SubwayMap, relations: Record<string, Relation>, joins: Join[], indexOfScene: (path: string) => number): Connector[] {
  const lane = (t: string) => map.lines.findIndex((l) => l.tag === t);
  const out: Connector[] = [];
  for (const [child, r] of Object.entries(relations)) {
    const c = lane(child);
    const p = lane(r.parent);
    const at = indexOfScene(r.at);
    if (c < 0 || p < 0 || at < 0) continue;
    const first = map.lines[c].stops[0];
    out.push({ fromLane: p, toLane: c, fromAt: at, toAt: first === undefined ? at : Math.max(first, at), kind: r.kind, color: map.lines[c].color });
  }
  for (const j of joins) {
    const a = lane(j.from);
    const b = lane(j.to);
    const at = indexOfScene(j.at);
    if (a < 0 || b < 0 || at < 0) continue;
    const before = map.lines[a].stops.filter((i) => i <= at);
    out.push({ fromLane: a, toLane: b, fromAt: before.length ? before[before.length - 1] : at, toAt: at, kind: "join", color: map.lines[a].color });
  }
  return out;
}

/** Where a plotline's drawn bar ends: a split parent stops at the scene where it splits. */
export function lineEnd(tag: string, stops: number[], relations: Record<string, Relation>, indexOfScene: (path: string) => number): number | undefined {
  const cut = Object.values(relations)
    .filter((r) => r.parent === tag && r.kind === "split")
    .map((r) => indexOfScene(r.at))
    .filter((i) => i >= 0);
  const limit = cut.length ? Math.min(...cut) : Infinity;
  const within = stops.filter((i) => i <= limit);
  return within.length ? within[within.length - 1] : stops[stops.length - 1];
}
