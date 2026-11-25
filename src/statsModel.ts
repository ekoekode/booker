/** Numbers for the Stats page, worked out from the scenes and the day table. Pure code. */
import { compareScenes } from "./project/format";
import type { HubScene } from "./project/hubModel";
import type { DayStats } from "./types";

/** Average adult silent reading speed, words a minute. */
export const READ_WPM = 238;

export function readMinutes(words: number): number {
  return Math.max(0, Math.round(words / READ_WPM));
}

export function clockHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export interface Overview {
  words: number;
  scenes: number;
  readMinutes: number;
  avgScene: number;
}

export function overview(scenes: HubScene[]): Overview {
  const words = scenes.reduce((n, s) => n + s.words, 0);
  return { words, scenes: scenes.length, readMinutes: readMinutes(words), avgScene: scenes.length ? Math.round(words / scenes.length) : 0 };
}

export interface Bucket {
  key: string;
  label: string;
  words: number;
  scenes: number;
}

/** Words and scenes per act (key = act) in reading order. */
export function perAct(scenes: HubScene[], actLabel: (a: number | string) => string = (a) => `Act ${a}`): Bucket[] {
  const out: Bucket[] = [];
  for (const s of [...scenes].sort(compareScenes)) {
    const key = String(s.act);
    let b = out.find((x) => x.key === key);
    if (!b) out.push((b = { key, label: actLabel(s.act), words: 0, scenes: 0 }));
    b.words += s.words;
    b.scenes++;
  }
  return out;
}

/** Words and scenes per chapter in reading order. */
export function perChapter(scenes: HubScene[], chapterLabel: (c: number | string) => string = (c) => `Chapter ${c}`): Bucket[] {
  const out: Bucket[] = [];
  for (const s of [...scenes].sort(compareScenes)) {
    const key = `${s.act}/${s.chapter ?? ""}`;
    let b = out.find((x) => x.key === key);
    if (!b) out.push((b = { key, label: s.chapter === undefined || s.chapter === "" ? "No chapter" : chapterLabel(s.chapter), words: 0, scenes: 0 }));
    b.words += s.words;
    b.scenes++;
  }
  return out;
}

export interface Share {
  name: string;
  scenes: number;
  words: number;
}

function share(scenes: HubScene[], names: (s: HubScene) => string[]): Share[] {
  const m = new Map<string, Share>();
  for (const s of scenes)
    for (const n of new Set(names(s))) {
      const e = m.get(n) ?? { name: n, scenes: 0, words: 0 };
      e.scenes++;
      e.words += s.words;
      m.set(n, e);
    }
  return [...m.values()].sort((a, b) => b.scenes - a.scenes || b.words - a.words || a.name.localeCompare(b.name));
}

export const povShare = (scenes: HubScene[]) => share(scenes, (s) => (s.pov ? [s.pov] : []));
export const characterShare = (scenes: HubScene[]) => share(scenes, (s) => [...(s.characters ?? []), ...(s.pov ? [s.pov] : [])]);
export const locationShare = (scenes: HubScene[]) => share(scenes, (s) => s.location ?? []);

// ------------------------------------------------------------------ writing history

export interface History {
  added: number;
  deleted: number;
  net: number;
  activeDays: number;
  bestDay: { key: string; added: number } | null;
}

export function history(days: Record<string, DayStats>): History {
  let added = 0;
  let net = 0;
  let activeDays = 0;
  let best: { key: string; added: number } | null = null;
  for (const [key, d] of Object.entries(days)) {
    added += d.added;
    net += d.net;
    if (d.added > 0) activeDays++;
    if (d.added > 0 && (!best || d.added > best.added)) best = { key, added: d.added };
  }
  return { added, deleted: added - net, net, activeDays, bestDay: best };
}

/** A grid of the last `weeks` weeks, one column per week starting on Monday, with each day's words added (null after today). */
export function activityGrid(days: Record<string, DayStats>, weeks = 12, now = new Date()): Array<Array<{ key: string; added: number } | null>> {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (end.getDay() + 6) % 7;
  const start = new Date(end);
  start.setDate(end.getDate() - mondayOffset - (weeks - 1) * 7);
  const cols: Array<Array<{ key: string; added: number } | null>> = [];
  for (let w = 0; w < weeks; w++) {
    const col: Array<{ key: string; added: number } | null> = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      col.push(day > end ? null : { key: key(day), added: days[key(day)]?.added ?? 0 });
    }
    cols.push(col);
  }
  return cols;
}

/** The day table as CSV. */
export function historyCsv(days: Record<string, DayStats>): string {
  const rows = Object.keys(days).sort().map((k) => `${k},${days[k].added},${days[k].added - days[k].net},${days[k].net}`);
  return ["date,added,deleted,net", ...rows].join("\n") + "\n";
}
