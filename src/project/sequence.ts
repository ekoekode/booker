import { parseStoryDate, shiftStoryDate } from "../dates";

/**
 * Time-linked, optionally sequential Codex items (the generalised "Lives").
 * Pure: no Obsidian imports. Frontmatter on each note is the only source of truth; dates written to `storyDate` are
 * derived from `anchor` / sequence order by `resolveStarts`, so recomputing is always safe (idempotent).
 */

export type AnchorEdge = "start" | "end";
export type AnchorMode = "after" | "with" | "before";

export interface SeqTemplate {
  id: string;
  label: string;
  /** Codex folder name the items live in */
  folder: string;
  /** frontmatter `type` */
  type: string;
  sequential: boolean;
  /** default gap between items, e.g. "3d", "2w", "1m", "1y" */
  defaultGap: string;
  /** what an item may be anchored to */
  anchorKinds: ("item" | "character" | "scene" | "event")[];
  /** false = switched off: settings, marks and dates are kept, but nothing follows, repairs or is checked. Missing = on. */
  enabled?: boolean;
}

export const isEnabled = (t: SeqTemplate | undefined): boolean => !!t && t.enabled !== false;

/** The built-in template that reproduces today's Lives behaviour. */
export const LIFE_TEMPLATE: SeqTemplate = {
  id: "life",
  label: "Life",
  folder: "Lives",
  type: "life",
  sequential: true,
  defaultGap: "3d",
  anchorKinds: ["character", "item"],
};

export interface SeqItem {
  path: string;
  /** sequence group: the parent the numbering is per (e.g. a character). "" when not sequential. */
  group: string;
  /** order inside the group; 0 or missing = free (outside the sequence) */
  seq: number;
  when: string;
  whenEnd: string;
  /** path of the anchor note, if the item has an explicit anchor */
  anchor?: string;
  anchorEdge?: AnchorEdge;
  anchorMode?: AnchorMode;
  /** per-item gap override */
  gap?: string;
}

/** A date source outside the item set (a scene, event, character or other codex note). */
export interface AnchorDate {
  when: string;
  whenEnd: string;
}

export interface DateEdit {
  path: string;
  when: string;
  whenEnd: string;
}

const DAYS_PER_YEAR = 365.25;

/** "3d" | "2w" | "1m" | "1y" (or a bare number of days) to years. null when unparseable. */
export function gapYears(gap: string | undefined): number | null {
  const t = (gap ?? "").trim().toLowerCase();
  if (!t) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*([dwmy]?)$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const days = m[2] === "w" ? n * 7 : m[2] === "m" ? n * 30.4375 : m[2] === "y" ? n * DAYS_PER_YEAR : n;
  return days / DAYS_PER_YEAR;
}

/** Sequence members of one group, in order (free items and undated-but-numbered items are kept; free ones excluded). */
export function groupOf(items: SeqItem[], group: string): SeqItem[] {
  return items.filter((i) => i.group === group && i.seq > 0).sort((a, b) => a.seq - b.seq);
}

/** What an item is attached to: its explicit anchor, else the previous item in its sequence. */
export function anchorOf(items: SeqItem[], item: SeqItem): string | undefined {
  if (item.anchor) return item.anchor;
  if (item.seq <= 0) return undefined;
  const prev = groupOf(items, item.group).filter((i) => i.seq < item.seq).pop();
  return prev?.path;
}

/** The date text of an anchor edge: start edge uses `when`, end edge uses `whenEnd` (open-ended gives ""). */
function edgeText(d: AnchorDate, edge: AnchorEdge): string {
  return edge === "end" ? d.whenEnd : d.when;
}

/**
 * Where an item starts given its anchor's date. `after` = anchor edge + gap, `with` = at the edge, `before` = the item
 * ends `gap` before the anchor's start (its start is moved so its length is kept).
 * Returns null when there is nothing to derive from (anchor has no date for that edge).
 */
export function startFrom(item: SeqItem, a: AnchorDate, defaultGap: string): DateEdit | null {
  const mode = item.anchorMode ?? "after";
  const edge: AnchorEdge = item.anchorEdge ?? (mode === "before" ? "start" : "end");
  // an anchor the author chose that is a single day has no separate end: its end is that day. (Following the previous item in a
  // sequence is different: a life with no end yet blocks the next one.)
  const text = edgeText(a, edge) || (item.anchor && edge === "end" ? a.when : "");
  if (!text) return null;
  const gy = gapYears(item.gap ?? defaultGap);
  if (gy === null) return null;
  const cur = parseStoryDate(item.when);
  const curEnd = item.whenEnd ? parseStoryDate(item.whenEnd) : null;
  let target: string;
  if (mode === "with") target = text;
  else if (mode === "after") target = shiftStoryDate(text, "", gy).when;
  else {
    // "before": the item's end sits `gap` before the anchor; shift the point, then back off by the item's length
    const len = cur && curEnd ? Math.max(0, curEnd.start - cur.start) : 0;
    target = shiftStoryDate(text, "", -(gy + len)).when;
  }
  if (!target) return null;
  const t = parseStoryDate(target);
  if (!t) return null;
  if (cur && item.whenEnd) {
    const pair = shiftStoryDate(item.when, item.whenEnd, t.start - cur.start);
    return { path: item.path, when: pair.when, whenEnd: pair.when_end };
  }
  return { path: item.path, when: target, whenEnd: "" };
}

export interface ResolveResult {
  edits: DateEdit[];
  /** paths that sit in an anchor cycle (not resolved) */
  cyclic: string[];
  /** paths whose anchor could not be found or had no usable date */
  unresolved: string[];
}

/**
 * Compute the start of every anchored or sequential item, following anchors in dependency order. Only items whose dates
 * actually change appear in `edits`. `external` supplies dates for anchors that are not in `items` (path -> dates).
 */
export function resolveStarts(
  items: SeqItem[],
  external: Map<string, AnchorDate>,
  templateOf: (item: SeqItem) => SeqTemplate | undefined,
): ResolveResult {
  const byPath = new Map(items.map((i) => [i.path, i]));
  const cur = new Map<string, AnchorDate>();
  for (const i of items) cur.set(i.path, { when: i.when, whenEnd: i.whenEnd });

  const anchorPath = new Map<string, string>();
  for (const i of items) {
    const a = anchorOf(items, i);
    if (a && a !== i.path) anchorPath.set(i.path, a);
  }

  // Kahn-style walk over items-with-anchors; cycles are whatever never becomes ready.
  const done = new Set<string>();
  const order: SeqItem[] = [];
  let progressed = true;
  const pending = new Set(anchorPath.keys());
  while (progressed && pending.size) {
    progressed = false;
    for (const p of [...pending]) {
      const a = anchorPath.get(p)!;
      if (!pending.has(a) || !byPath.has(a)) {
        pending.delete(p);
        done.add(p);
        order.push(byPath.get(p)!);
        progressed = true;
      }
    }
  }
  const cyclic = [...pending];

  const edits: DateEdit[] = [];
  const unresolved: string[] = [];
  for (const item of order) {
    const a = anchorPath.get(item.path)!;
    const src = cur.get(a) ?? external.get(a);
    const tpl = templateOf(item);
    if (!src) {
      unresolved.push(item.path);
      continue;
    }
    const edit = startFrom(item, src, tpl?.defaultGap ?? "0d");
    if (!edit) {
      unresolved.push(item.path);
      continue;
    }
    cur.set(item.path, { when: edit.when, whenEnd: edit.whenEnd });
    if (edit.when !== item.when || edit.whenEnd !== item.whenEnd) edits.push(edit);
  }
  return { edits, cyclic, unresolved };
}

export interface NewItem {
  /** frontmatter for the new note */
  fm: Record<string, unknown>;
  number: number;
  storyDate: string;
}

/**
 * Frontmatter for a new item from a template. In a sequence it is numbered after the group's last item and starts one gap
 * after that item ends (blank when that one has no end yet); a free item has no number and no dates.
 */
export interface NewItemOptions {
  /** this item's own gap; empty uses the template's */
  gap?: string;
  /** link text of the note it is anchored to, such as "Scene 12" (no brackets) */
  anchor?: string;
  anchorMode?: AnchorMode;
  anchorEdge?: AnchorEdge;
  /** the anchor note's dates, so the new item starts where the anchor says */
  anchorDate?: AnchorDate;
}

export function buildItem(tpl: SeqTemplate, group: string, existing: SeqItem[], name: string, inSequence: boolean, today: string, opts: NewItemOptions = {}): NewItem {
  const key = `${tpl.id}/${group}`;
  const mine = existing.filter((i) => i.group === key);
  const number = inSequence && tpl.sequential ? mine.reduce((m, i) => Math.max(m, i.seq), 0) + 1 : 0;
  let storyDate = "";
  if (opts.anchorDate) {
    const probe: SeqItem = { path: "", group: key, seq: number, when: "", whenEnd: "", anchorMode: opts.anchorMode, anchorEdge: opts.anchorEdge, gap: opts.gap || undefined, anchor: opts.anchor };
    storyDate = startFrom(probe, opts.anchorDate, tpl.defaultGap)?.when ?? "";
  } else if (number > 1) {
    const prev = groupOf(mine, key).pop();
    if (prev) {
      const e = startFrom({ path: "", group: key, seq: number, when: "", whenEnd: "" }, { when: prev.when, whenEnd: prev.whenEnd }, tpl.defaultGap);
      storyDate = e?.when ?? "";
    }
  }
  const fm: Record<string, unknown> = { type: tpl.type, name, template: tpl.id, sequence: key, number: number || "", storyDate, created: today, modified: today };
  if (tpl.anchorKinds.includes("character") && group) fm.character = `[[${group}]]`;
  if (opts.anchor) {
    fm.anchor = `[[${opts.anchor}]]`;
    if (opts.anchorMode) fm.anchorMode = opts.anchorMode;
    if (opts.anchorEdge) fm.anchorEdge = opts.anchorEdge;
  }
  if (opts.gap) fm.gap = opts.gap;
  return { fm, number, storyDate };
}
