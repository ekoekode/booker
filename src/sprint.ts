/** A timed writing sprint. Words are counted from the live-typing total, so pasted-in sync changes never count. */
export interface Sprint {
  startedAt: number;
  minutes: number;
  /** the session word total when the sprint began */
  startTotal: number;
  /** set once the sprint is over */
  endedAt?: number;
  endTotal?: number;
  /** set once the finished sprint has been added to the history */
  recorded?: boolean;
}

export const SPRINT_LENGTHS = [10, 15, 25, 45, 60, 90, 120, 150];

/** "25 min", "1 h", "1 h 30 min", "2.5 hours" style labels for the length menu. */
export function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function startSprint(minutes: number, total: number, now = Date.now()): Sprint {
  return { startedAt: now, minutes, startTotal: total };
}

export function msLeft(s: Sprint, now = Date.now()): number {
  return Math.max(0, s.startedAt + s.minutes * 60000 - (s.endedAt ?? now));
}

export function isDone(s: Sprint, now = Date.now()): boolean {
  return s.endedAt !== undefined || msLeft(s, now) === 0;
}

/** Ends the sprint now (or at its natural end if that has passed). */
export function finish(s: Sprint, total: number, now = Date.now()): Sprint {
  if (s.endedAt !== undefined) return s;
  return { ...s, endedAt: Math.min(now, s.startedAt + s.minutes * 60000), endTotal: total };
}

export function sprintWords(s: Sprint, total: number): number {
  return Math.max(0, (s.endTotal ?? total) - s.startTotal);
}

export function clock(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  if (sec >= 3600) return `${Math.floor(sec / 3600)}:${two(Math.floor((sec % 3600) / 60))}:${two(sec % 60)}`;
  return `${Math.floor(sec / 60)}:${two(sec % 60)}`;
}

/** Words per minute over the time actually spent. */
export function pace(s: Sprint, total: number, now = Date.now()): number {
  const mins = Math.max(((s.endedAt ?? now) - s.startedAt) / 60000, 1 / 60);
  return Math.round(sprintWords(s, total) / mins);
}

/** A finished sprint, kept in the history. */
export interface SprintRecord {
  /** start time, ms since 1970 */
  at: number;
  /** minutes the sprint ran */
  minutes: number;
  words: number;
  /** minutes actually spent */
  spent: number;
}

export const MAX_SPRINT_HISTORY = 500;

export function recordOf(s: Sprint, total: number): SprintRecord {
  const end = s.endedAt ?? Date.now();
  return { at: s.startedAt, minutes: s.minutes, words: sprintWords(s, total), spent: Math.round(((end - s.startedAt) / 60000) * 10) / 10 };
}

export interface SprintTotals {
  count: number;
  words: number;
  minutes: number;
  /** average words a minute over the time spent */
  wpm: number;
}

function totalsOf(list: SprintRecord[]): SprintTotals {
  const words = list.reduce((n, r) => n + r.words, 0);
  const minutes = list.reduce((n, r) => n + r.spent, 0);
  return { count: list.length, words, minutes: Math.round(minutes * 10) / 10, wpm: minutes > 0 ? Math.round(words / minutes) : 0 };
}

/** Totals for all sprints and for today, the last 7 days and the last 30 days. */
export function sprintTotals(history: SprintRecord[], now = new Date()): { all: SprintTotals; today: SprintTotals; week: SprintTotals; month: SprintTotals } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const since = (days: number) => history.filter((r) => r.at >= midnight - (days - 1) * 86400000);
  return { all: totalsOf(history), today: totalsOf(since(1)), week: totalsOf(since(7)), month: totalsOf(since(30)) };
}

/** The history with one more record, newest last, trimmed to the cap. */
export function addRecord(history: SprintRecord[], r: SprintRecord): SprintRecord[] {
  return [...history, r].slice(-MAX_SPRINT_HISTORY);
}
