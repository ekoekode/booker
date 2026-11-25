import { TFile, debounce } from "obsidian";
import type BookerPlugin from "./main";
import { countWords, pad2 } from "./text";
import { isScene } from "./project/format";
import { DayStats } from "./types";

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Longest run of consecutive days (ending today or yesterday) with at least `min` words added. */
export function currentStreak(days: Record<string, DayStats>, min = 1, now = new Date()): number {
  let streak = 0;
  const d = new Date(now);
  // today may still be in progress: don't break the streak for it
  if ((days[dayKey(d)]?.added ?? 0) >= min) streak++;
  d.setDate(d.getDate() - 1);
  for (;;) {
    if ((days[dayKey(d)]?.added ?? 0) >= min) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

export function lastDays(days: Record<string, DayStats>, n: number, now = new Date()): { key: string; stats: DayStats }[] {
  const out: { key: string; stats: DayStats }[] = [];
  const d = new Date(now);
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const key = dayKey(d);
    out.push({ key, stats: days[key] ?? { net: 0, added: 0 } });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Counts words written per day. Only live edits count: on startup the current
 * word counts are taken as the baseline, so syncing a vault from another
 * device never inflates today's total.
 */
export class StatsTracker {
  /** words typed since Obsidian started; sprints measure against this */
  sessionAdded = 0;
  private save = debounce(() => this.plugin.persist(), 2000, true);

  constructor(private plugin: BookerPlugin) {}

  get days() {
    return this.plugin.data.days;
  }

  private isScene(file: TFile): boolean {
    const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return !!fm && isScene(fm);
  }

  /** Establish baselines for all scenes without counting them. */
  async reconcile() {
    const counts = this.plugin.data.wordCounts;
    const seen = new Set<string>();
    for (const f of this.plugin.app.vault.getMarkdownFiles()) {
      if (!this.isScene(f)) continue;
      seen.add(f.path);
      counts[f.path] = countWords(await this.plugin.app.vault.cachedRead(f));
    }
    for (const p of Object.keys(counts)) if (!seen.has(p)) delete counts[p];
    this.save();
  }

  async onModify(file: TFile) {
    if (file.extension !== "md" || !this.isScene(file)) return;
    const text = await this.plugin.app.vault.cachedRead(file);
    const words = countWords(text);
    const prev = this.plugin.data.wordCounts[file.path];
    this.plugin.data.wordCounts[file.path] = words;
    if (prev === undefined) return; // new file: baseline only
    const delta = words - prev;
    if (delta === 0) return;
    // only count what this person typed: changes arriving from a collaborator or a sync just move the baseline
    const typedAt = this.plugin.localEdits.get(file.path) ?? 0;
    if (Date.now() - typedAt > 6000) {
      this.save();
      return;
    }
    const key = dayKey();
    const day = (this.days[key] ??= { net: 0, added: 0 });
    day.net += delta;
    if (delta > 0) {
      day.added += delta;
      this.sessionAdded += delta;
    }
    this.save();
    this.plugin.events.trigger("stats");
  }

  onRename(oldPath: string, file: TFile) {
    const c = this.plugin.data.wordCounts;
    if (oldPath in c) {
      c[file.path] = c[oldPath];
      delete c[oldPath];
      this.save();
    }
  }

  onDelete(path: string) {
    delete this.plugin.data.wordCounts[path];
    this.save();
  }

  /** Start today's count again from zero. Returns what was there, so it can be put back. */
  resetToday(): DayStats | undefined {
    const key = dayKey();
    const prev = this.days[key];
    this.days[key] = { net: 0, added: 0 };
    this.save();
    this.plugin.events.trigger("stats");
    return prev ? { ...prev } : undefined;
  }

  restoreToday(prev: DayStats | undefined) {
    const key = dayKey();
    if (prev) this.days[key] = prev;
    else delete this.days[key];
    this.save();
    this.plugin.events.trigger("stats");
  }

  today(): DayStats {
    return this.days[dayKey()] ?? { net: 0, added: 0 };
  }
}
