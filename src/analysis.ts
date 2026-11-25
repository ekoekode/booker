/**
 * Pure analysis over plain data (no Obsidian types): plot state, continuity
 * checks and timeline item derivation. Names are note basenames.
 */
import { overlaps, StoryDate } from "./dates";

export interface SceneData {
  path: string;
  title: string;
  book: string;
  /** position in reading order across the series */
  order: number;
  act: string;
  chapter: string;
  status: string;
  words: number;
  pov: string | null;
  characters: string[];
  location: string | null;
  lives: string[];
  when: StoryDate | null;
  whenRaw: string;
  opens: string[];
  advances: string[];
  resolves: string[];
  /** link targets in properties that did not resolve to a note */
  unresolved: string[];
}

export interface LifeData {
  path: string;
  name: string;
  character: string;
  number: number;
  lifeName: string | null;
  /** inclusive-start / exclusive-end; end is Infinity when the life has no end date */
  span: { start: number; end: number } | null;
  howEnded: string | null;
}

export interface CharacterData {
  path: string;
  name: string;
}

export interface EventData {
  path: string;
  title: string;
  when: StoryDate | null;
  characters: string[];
  location: string | null;
}

export interface PlotlineData {
  path: string;
  name: string;
  kind: string;
  color: string | null;
}

// ---------------------------------------------------------------- plotlines

export type PlotState = "never-opened" | "open" | "advancing" | "resolved" | "dangling";

export interface PlotBeat {
  scene: SceneData;
  role: "open" | "advance" | "resolve";
}

export interface PlotStatus {
  plotline: PlotlineData;
  state: PlotState;
  beats: PlotBeat[];
  opener: SceneData | null;
  lastTouch: SceneData | null;
  resolvers: SceneData[];
  /** scenes in the series after the last touch */
  scenesSinceLastTouch: number;
  problems: string[];
}

export function plotStatuses(plotlines: PlotlineData[], scenes: SceneData[]): PlotStatus[] {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  return plotlines.map((p) => {
    const beats: PlotBeat[] = [];
    for (const s of ordered) {
      if (s.opens.includes(p.name)) beats.push({ scene: s, role: "open" });
      if (s.advances.includes(p.name)) beats.push({ scene: s, role: "advance" });
      if (s.resolves.includes(p.name)) beats.push({ scene: s, role: "resolve" });
    }
    const opens = beats.filter((b) => b.role === "open");
    const resolves = beats.filter((b) => b.role === "resolve");
    const opener = opens[0]?.scene ?? null;
    const problems: string[] = [];
    let state: PlotState;
    if (beats.length === 0) state = "never-opened";
    else if (!opener) {
      state = "dangling";
      problems.push("Advanced or resolved but never opened");
    } else if (resolves.length) state = "resolved";
    else if (beats.some((b) => b.role === "advance")) state = "advancing";
    else state = "open";

    if (opener) {
      const early = beats.find((b) => b.scene.order < opener.order);
      if (early) problems.push(`Touched in "${early.scene.title}" before it opens`);
    }
    if (opens.length > 1) problems.push(`Opened ${opens.length} times`);
    if (resolves.length > 1) problems.push(`Resolved ${resolves.length} times`);
    if (resolves.length && opener) {
      const advanceAfter = beats.find((b) => b.role === "advance" && b.scene.order > resolves[0].scene.order);
      if (advanceAfter) problems.push(`Advanced in "${advanceAfter.scene.title}" after it was resolved`);
    }
    const last = beats.length ? beats[beats.length - 1].scene : null;
    const since = last ? ordered.filter((s) => s.order > last.order).length : ordered.length;
    return {
      plotline: p,
      state,
      beats,
      opener,
      lastTouch: last,
      resolvers: resolves.map((r) => r.scene),
      scenesSinceLastTouch: since,
      problems,
    };
  });
}

// ------------------------------------------------------------------- lints

export type Severity = "error" | "warn" | "info";

export interface Lint {
  severity: Severity;
  code: string;
  message: string;
  path: string;
  /** extra related paths */
  related?: string[];
}

export interface LintInput {
  scenes: SceneData[];
  characters: CharacterData[];
  lives: LifeData[];
  plotlines: PlotlineData[];
  /** books that are finished, for the unresolved-plotline check */
  lastBook?: string;
}

const SHORT_SPAN = 1 / 12 + 1e-9; // up to about a month counts as "precise enough" for place checks

export function lifeFor(lives: LifeData[], character: string, scene: SceneData): { life: LifeData | null; ambiguous: boolean } {
  const mine = lives.filter((l) => l.character === character);
  if (mine.length === 0) return { life: null, ambiguous: false };
  const named = mine.find((l) => scene.lives.includes(l.name));
  if (named) return { life: named, ambiguous: false };
  if (mine.length === 1) return { life: mine[0], ambiguous: false };
  if (scene.when) {
    const matching = mine.filter((l) => l.span && overlaps(l.span, scene.when!));
    if (matching.length === 1) return { life: matching[0], ambiguous: false };
    if (matching.length > 1) return { life: null, ambiguous: true };
  }
  return { life: null, ambiguous: true };
}

export function runLints(input: LintInput): Lint[] {
  const out: Lint[] = [];
  const { scenes, lives, plotlines } = input;
  const known = new Set(input.characters.map((c) => c.name));
  const sceneUsesDates = scenes.some((s) => s.when);

  for (const s of scenes) {
    if (!s.pov) out.push({ severity: "warn", code: "no-pov", message: "No POV character", path: s.path });
    if (s.pov && !s.characters.includes(s.pov))
      out.push({ severity: "info", code: "pov-not-listed", message: `POV ${s.pov} is not in the characters list`, path: s.path });
    if (s.whenRaw && !s.when) out.push({ severity: "error", code: "bad-date", message: `Cannot read date "${s.whenRaw}"`, path: s.path });
    if (!s.whenRaw && sceneUsesDates) out.push({ severity: "info", code: "no-date", message: "No story date", path: s.path });
    if (s.words === 0 && !["idea", "outline", "outlined", "stub"].includes(s.status))
      out.push({ severity: "warn", code: "empty", message: `Status is ${s.status} but the scene has no text`, path: s.path });
    for (const u of s.unresolved)
      out.push({ severity: "warn", code: "unresolved-link", message: `"${u}" has no note in the Codex`, path: s.path });

    // plot references to unknown plotlines
    const plotNames = new Set(plotlines.map((p) => p.name));
    for (const n of [...s.opens, ...s.advances, ...s.resolves])
      if (!plotNames.has(n)) out.push({ severity: "warn", code: "unknown-plotline", message: `"${n}" is not a plotline note`, path: s.path });

    // lives
    const present = [...new Set([...(s.pov ? [s.pov] : []), ...s.characters])];
    for (const c of present) {
      const { life, ambiguous } = lifeFor(lives, c, s);
      if (ambiguous)
        out.push({ severity: "warn", code: "which-life", message: `${c} has several lives: which one is this scene in?`, path: s.path });
      if (life && life.span && s.when) {
        if (!overlaps(life.span, s.when))
          out.push({
            severity: "error",
            code: "outside-life",
            message: `${c} appears outside ${life.name} (${life.span.start}–${Number.isFinite(life.span.end) ? life.span.end : "ongoing"})`,
            path: s.path,
            related: [life.path],
          });
      }
    }
    for (const ln of s.lives) {
      const life = lives.find((l) => l.name === ln);
      if (life && !present.includes(life.character))
        out.push({ severity: "warn", code: "life-mismatch", message: `Lists ${ln} but ${life.character} is not in the scene`, path: s.path });
    }
  }

  // two places at once
  const precise = scenes.filter((s) => s.when && s.when.end - s.when.start <= SHORT_SPAN && s.location);
  for (let i = 0; i < precise.length; i++) {
    for (let j = i + 1; j < precise.length; j++) {
      const a = precise[i];
      const b = precise[j];
      if (a.location === b.location) continue;
      if (!overlaps(a.when!, b.when!)) continue;
      const pa = new Set([...(a.pov ? [a.pov] : []), ...a.characters]);
      const shared = [...(b.pov ? [b.pov] : []), ...b.characters].filter((c) => pa.has(c));
      if (shared.length)
        out.push({
          severity: "warn",
          code: "two-places",
          message: `${[...new Set(shared)].join(", ")} in ${a.location} and ${b.location} at the same time`,
          path: a.path,
          related: [b.path],
        });
    }
  }

  // plotlines
  const statuses = plotStatuses(plotlines, scenes);
  for (const st of statuses) {
    for (const p of st.problems) out.push({ severity: "warn", code: "plot-problem", message: `${st.plotline.name}: ${p}`, path: st.plotline.path });
    if (st.state === "never-opened") out.push({ severity: "info", code: "plot-unused", message: `${st.plotline.name}: never used in a scene`, path: st.plotline.path });
    if ((st.state === "open" || st.state === "advancing") && st.opener)
      out.push({ severity: "info", code: "plot-unresolved", message: `${st.plotline.name}: still open`, path: st.plotline.path });
  }
  return out;
}

// ------------------------------------------------------------ timeline data

/** scene, life, event, chapter, act or the type of any dated codex note */
export type TimelineKind = string;
export type GroupBy = "character" | "plotline" | "location" | "book" | "none";

export interface TimelineItem {
  /** where Day 1, Week 1 and Year 1 fall for this item (a day count), so relative dates can be dragged */
  anchor?: number;
  id: string;
  path: string;
  kind: TimelineKind;
  label: string;
  start: number;
  end: number;
  approx: boolean;
  fuzz: number;
  /** open-ended (continues past the right edge) */
  open: boolean;
  /** lane keys per grouping */
  characters: string[];
  plotlines: string[];
  locations: string[];
  book: string;
  color?: string | null;
  detail?: string;
  /** for a life: its place in the character's sequence of lives, 0 when it floats free */
  seq?: number;
  /** which sequence a numbered item belongs to (template id / group), so only its own neighbours follow a drag */
  seqGroup?: string;
  /** lives this item belongs to or links (names of life notes) */
  lives?: string[];
  /** a span worked out from scenes (an act or chapter): shown, not draggable */
  derived?: boolean;
  /** where a scene sits, used to build chapter and act spans */
  act?: string;
  chapter?: string;
}

export interface TimelineInput {
  scenes: SceneData[];
  events: EventData[];
  lives: LifeData[];
  plotlines: PlotlineData[];
}

export function timelineItems(input: TimelineInput): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const s of input.scenes) {
    if (!s.when) continue;
    const plots = [...new Set([...s.opens, ...s.advances, ...s.resolves])];
    items.push({
      id: s.path,
      path: s.path,
      kind: "scene",
      label: s.title,
      start: s.when.start,
      end: s.when.end,
      approx: s.when.approx,
      fuzz: s.when.fuzz,
      open: false,
      characters: [...new Set([...(s.pov ? [s.pov] : []), ...s.characters])],
      plotlines: plots,
      locations: s.location ? [s.location] : [],
      book: s.book,
      detail: s.when.display,
    });
  }
  for (const e of input.events) {
    if (!e.when) continue;
    items.push({
      id: e.path,
      path: e.path,
      kind: "event",
      label: e.title,
      start: e.when.start,
      end: e.when.end,
      approx: e.when.approx,
      fuzz: e.when.fuzz,
      open: false,
      characters: e.characters,
      plotlines: [],
      locations: e.location ? [e.location] : [],
      book: "",
      detail: e.when.display,
    });
  }
  for (const l of input.lives) {
    if (!l.span) continue;
    items.push({
      id: l.path,
      path: l.path,
      kind: "life",
      label: l.lifeName ? `${l.lifeName} (life ${l.number})` : `Life ${l.number}`,
      start: l.span.start,
      end: Number.isFinite(l.span.end) ? l.span.end : l.span.start + 1,
      approx: false,
      fuzz: 0,
      open: !Number.isFinite(l.span.end),
      characters: [l.character],
      plotlines: [],
      locations: [],
      book: "",
      detail: l.howEnded ?? undefined,
    });
  }
  // plotline spans: first dated beat to last dated beat
  const statuses = plotStatuses(input.plotlines, input.scenes);
  for (const st of statuses) {
    const dated = st.beats.filter((b) => b.scene.when);
    if (dated.length === 0) continue;
    const start = Math.min(...dated.map((b) => b.scene.when!.start));
    const end = Math.max(...dated.map((b) => b.scene.when!.end));
    items.push({
      id: `plot:${st.plotline.path}`,
      path: st.plotline.path,
      kind: "plotline",
      label: st.plotline.name,
      start,
      end: Math.max(end, start + 1e-6),
      approx: false,
      fuzz: 0,
      open: st.state === "open" || st.state === "advancing",
      characters: [],
      plotlines: [st.plotline.name],
      locations: [],
      book: "",
      color: st.plotline.color,
      detail: st.state,
    });
  }
  return items;
}

export interface Lane {
  key: string;
  items: TimelineItem[];
}

export function groupLanes(items: TimelineItem[], by: GroupBy): Lane[] {
  const map = new Map<string, TimelineItem[]>();
  const push = (k: string, it: TimelineItem) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  };
  for (const it of items) {
    let keys: string[];
    switch (by) {
      case "character":
        keys = it.characters;
        break;
      case "plotline":
        keys = it.plotlines;
        break;
      case "location":
        keys = it.locations;
        break;
      case "book":
        keys = it.book ? [it.book] : ["(not in a book)"];
        break;
      default:
        keys = ["All"];
    }
    if (keys.length === 0) keys = ["(none)"];
    for (const k of keys) push(k, it);
  }
  const lanes = [...map.entries()].map(([key, its]) => ({ key, items: its.sort((a, b) => a.start - b.start) }));
  // "(none)" last, otherwise earliest first appearance
  return lanes.sort((a, b) => {
    if (a.key === "(none)") return 1;
    if (b.key === "(none)") return -1;
    return a.items[0].start - b.items[0].start || a.key.localeCompare(b.key);
  });
}

/** Greedy row packing in screen space. `width(item)` must return the pixel x-extent. */
export function packRows(items: { x0: number; x1: number }[], gap = 4): number[] {
  const rowEnds: number[] = [];
  const rows: number[] = new Array(items.length).fill(0);
  const order = items.map((_, i) => i).sort((a, b) => items[a].x0 - items[b].x0);
  for (const i of order) {
    let r = rowEnds.findIndex((end) => end + gap <= items[i].x0);
    if (r === -1) {
      r = rowEnds.length;
      rowEnds.push(-Infinity);
    }
    rowEnds[r] = items[i].x1;
    rows[i] = r;
  }
  return rows;
}
