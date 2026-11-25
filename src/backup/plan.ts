/**
 * Backup planning: what changed since the last run, when the next one is due, what to keep. Pure code, no Obsidian
 * or disk access, so it can be tested on its own.
 */
export type Schedule = "manual" | "hourly" | "daily" | "weekly";
export type BackupMode = "full" | "incremental";

export interface BackupConfig {
  /** where backups are written (a folder on this computer, or a folder inside the vault on a phone or tablet) */
  dir: string;
  schedule: Schedule;
  mode: BackupMode;
  /** how many full backups (and the incrementals after them) to keep */
  keep: number;
  /** a book of a series also saves the series' shared Codex */
  includeCodex: boolean;
  /** when the last backup finished, ms since 1970 */
  lastAt?: number;
  /** a one-line result of the last run */
  lastNote?: string;
}

export const DEFAULT_BACKUP: BackupConfig = { dir: "", schedule: "daily", mode: "incremental", keep: 5, includeCodex: true };

/** An incremental chain starts afresh with a full copy after this many incrementals. */
export const FULL_EVERY = 10;

export interface FileInfo {
  /** path relative to the project's parent folder, so the project folder name is the first part */
  path: string;
  size: number;
  mtime: number;
}

export interface Manifest {
  /** the stamp of the full backup the chain started from */
  fullStamp: string;
  /** how many incrementals since */
  runs: number;
  files: Record<string, { size: number; mtime: number }>;
}

export interface Diff {
  added: string[];
  changed: string[];
  removed: string[];
}

export function diffManifest(prev: Manifest["files"], now: FileInfo[]): Diff {
  const seen = new Set<string>();
  const d: Diff = { added: [], changed: [], removed: [] };
  for (const f of now) {
    seen.add(f.path);
    const p = prev[f.path];
    if (!p) d.added.push(f.path);
    else if (p.size !== f.size || p.mtime !== f.mtime) d.changed.push(f.path);
  }
  for (const p of Object.keys(prev)) if (!seen.has(p)) d.removed.push(p);
  return d;
}

export const hasChanges = (d: Diff) => d.added.length + d.changed.length + d.removed.length > 0;

const PERIOD: Record<Exclude<Schedule, "manual">, number> = { hourly: 3600_000, daily: 86_400_000, weekly: 604_800_000 };

/** Is a scheduled backup due? Never for manual; always when none has run yet. */
export function isDue(cfg: Pick<BackupConfig, "schedule" | "lastAt" | "dir">, now = Date.now()): boolean {
  if (cfg.schedule === "manual" || !cfg.dir) return false;
  if (cfg.lastAt === undefined) return true;
  return now - cfg.lastAt >= PERIOD[cfg.schedule];
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** "2026-10-26 093012": sorts as time sorts, safe in a file name. */
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

export const isStamp = (s: string) => /^\d{4}-\d{2}-\d{2} \d{6}$/.test(s);

export type RunPlan = { kind: "full" } | { kind: "incremental"; diff: Diff } | { kind: "nothing" };

/** What this run should do. The first run, a full-mode run, and every FULL_EVERY-th incremental are full copies. */
export function planRun(mode: BackupMode, prev: Manifest | null, now: FileInfo[]): RunPlan {
  if (mode === "full" || !prev || prev.runs >= FULL_EVERY) return mode === "full" && prev && !hasChanges(diffManifest(prev.files, now)) ? { kind: "nothing" } : { kind: "full" };
  const diff = diffManifest(prev.files, now);
  return hasChanges(diff) ? { kind: "incremental", diff } : { kind: "nothing" };
}

/** Full-backup stamps (sorted) to delete so that only the newest `keep` remain; incrementals older than the oldest kept full go too. */
export function prune(fullStamps: string[], incrementalStamps: string[], keep: number): { fulls: string[]; incrementals: string[] } {
  const fulls = [...fullStamps].sort();
  const n = Math.max(1, keep);
  const dropFulls = fulls.slice(0, Math.max(0, fulls.length - n));
  const oldestKept = fulls[fulls.length - n] ?? fulls[0];
  const dropInc = oldestKept ? incrementalStamps.filter((s) => s < oldestKept) : [];
  return { fulls: dropFulls, incrementals: dropInc };
}

/** The backups to replay to get the state at `upTo` (default: latest): the newest full at or before it, then the incrementals after that. */
export function restoreChain(fullStamps: string[], incrementalStamps: string[], upTo?: string): { full: string; incrementals: string[] } | null {
  const limit = upTo ?? "￿";
  const full = [...fullStamps].filter((s) => s <= limit).sort().pop();
  if (!full) return null;
  return { full, incrementals: [...incrementalStamps].filter((s) => s > full && s <= limit).sort() };
}
