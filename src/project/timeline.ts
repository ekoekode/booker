/**
 * The timeline is not a file of its own: it is the scenes laid out by reading order (act, chapter, sequence) or by
 * story order (chronologicalOrder, then storyDate and storyTime). Pure code; the view and the property writes live elsewhere.
 */
import { compareScenes } from "./format";

export const TIMELINE_MODES = ["linear", "flashback", "flash_forward", "parallel", "frame", "simultaneous", "timeskip", "dream", "mythic", "circular"] as const;
export type TimelineMode = (typeof TIMELINE_MODES)[number];

export const MODE_LABELS: Record<TimelineMode, string> = {
  linear: "Linear",
  flashback: "Flashback",
  flash_forward: "Flash-forward",
  parallel: "Parallel timeline",
  frame: "Frame narrative",
  simultaneous: "Simultaneous",
  timeskip: "Time skip",
  dream: "Dream / Vision",
  mythic: "Mythic / Legend",
  circular: "Circular",
};

export const MODE_ICONS: Record<TimelineMode, string> = {
  linear: "arrow-right",
  flashback: "undo-2",
  flash_forward: "redo-2",
  parallel: "git-branch",
  frame: "frame",
  simultaneous: "copy",
  timeskip: "skip-forward",
  dream: "cloud",
  mythic: "scroll-text",
  circular: "repeat",
};

export function parseMode(v: unknown): TimelineMode {
  return (TIMELINE_MODES as readonly string[]).includes(String(v)) ? (v as TimelineMode) : "linear";
}

export interface TimelineScene {
  path: string;
  title: string;
  act: number | string;
  chapter?: number | string;
  sequence: number;
  pov?: string;
  characters?: string[];
  location?: string[];
  tags?: string[];
  storyDate?: string;
  storyTime?: string;
  chronologicalOrder?: number;
  mode: TimelineMode;
  /** set when the whole series is shown: the book's name and its place in the series */
  book?: string;
  bookRank?: number;
}

export type Order = "reading" | "chronological";

const num = (x: number | string | undefined) => (x === undefined || x === "" ? Infinity : typeof x === "number" ? x : /^\d+$/.test(x) ? Number(x) : Infinity);
const dateKey = (s: TimelineScene) => {
  const d = (s.storyDate ?? "").trim();
  const t = (s.storyTime ?? "").trim();
  return d || t ? `${d} ${t}`.trim() : "";
};

/** The comparison: chronologicalOrder first, then the date text, then reading order. */
export function compareChronological(a: TimelineScene, b: TimelineScene): number {
  if (a.chronologicalOrder != null || b.chronologicalOrder != null) {
    const d = (a.chronologicalOrder ?? Number.MAX_SAFE_INTEGER) - (b.chronologicalOrder ?? Number.MAX_SAFE_INTEGER);
    if (d !== 0) return d;
  }
  const ka = dateKey(a);
  const kb = dateKey(b);
  if (ka || kb) {
    if (!ka) return 1;
    if (!kb) return -1;
    const d = ka.localeCompare(kb);
    if (d !== 0) return d;
  }
  return num(a.act) - num(b.act) || num(a.chapter) - num(b.chapter) || a.sequence - b.sequence;
}

export function orderScenes(scenes: TimelineScene[], order: Order): TimelineScene[] {
  return [...scenes].sort(order === "reading" ? (a, b) => (a.bookRank ?? 0) - (b.bookRank ?? 0) || compareScenes(a, b) : compareChronological);
}

/** Moving one card in story order: every scene is numbered 1..n so the order is explicit and every tool reads the same. */
export function reorder(ordered: TimelineScene[], from: number, to: number): Array<{ path: string; chronologicalOrder: number }> {
  const list = [...ordered];
  const [m] = list.splice(from, 1);
  list.splice(Math.min(to, list.length), 0, m);
  return list.map((s, i) => ({ path: s.path, chronologicalOrder: i + 1 })).filter((o, i) => ordered[i]?.path !== o.path || ordered[i]?.chronologicalOrder !== o.chronologicalOrder);
}

const MS = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  if (!t) return null;
  const n = Date.parse(/^\d{4}$/.test(t) ? `${t}-01-01` : t);
  return Number.isNaN(n) ? null : n;
};

const SKIPS: ReadonlySet<TimelineMode> = new Set(["flashback", "flash_forward", "dream", "mythic", "circular", "simultaneous"]);

/**
 * Indexes of scenes whose story date is earlier than the one before it, in a linear scene that is not marked as a
 * flashback and so on: the author probably forgot to mark a jump in time.
 */
export function backwardJumps(ordered: TimelineScene[]): Set<number> {
  const out = new Set<number>();
  let prev: number | null = null;
  ordered.forEach((s, i) => {
    const t = MS(s.storyDate);
    if (t === null) return;
    if (prev !== null && t < prev && !SKIPS.has(s.mode)) out.add(i);
    prev = t;
  });
  return out;
}

export type GroupBy = "pov" | "location" | "character" | "tag";

/** Which lanes a scene belongs to when the timeline is split into swimlanes. */
export function laneKeys(s: TimelineScene, by: GroupBy): string[] {
  const list = by === "pov" ? (s.pov ? [s.pov] : []) : by === "location" ? s.location ?? [] : by === "character" ? s.characters ?? [] : s.tags ?? [];
  const keys = [...new Set(list.map((x) => x.trim()).filter(Boolean))];
  return keys.length ? keys : [by === "pov" ? "(no POV)" : by === "location" ? "(no place)" : by === "character" ? "(no character)" : "(no plotline)"];
}

export function lanes(ordered: TimelineScene[], by: GroupBy): string[] {
  const seen: string[] = [];
  for (const s of ordered) for (const k of laneKeys(s, by)) if (!seen.includes(k)) seen.push(k);
  return seen;
}
