/**
 * Plot-hole and continuity checks on the scenes of one book. Pure code: it reads what is already in the scene
 * properties and says what looks wrong; it never changes anything.
 */
import { parseStoryDate } from "../dates";
import { backwardJumps, parseMode, type TimelineScene } from "./timeline";

export type ContKind = "unpaid-setup" | "payoff-first" | "dormant" | "date-back" | "two-places";

export interface ContScene {
  path: string;
  title: string;
  /** reading position, 0 first */
  order: number;
  tags: string[];
  /** plotlines this scene sets up / pays off (the marks on the plotlines map) */
  plotSetup: string[];
  plotPayoff: string[];
  characters: string[];
  pov?: string;
  location: string[];
  storyDate?: string;
  storyTime?: string;
  timelineMode?: string;
  /** the book's timeline start, for dates such as Day 3 */
  anchor?: string;
}

export interface ContIssue {
  kind: ContKind;
  message: string;
  /** a scene to open */
  path?: string;
}

/** How many scenes in a row a plotline may skip before it is called dormant. */
export const DORMANT_AFTER = 8;

export function checkContinuity(scenes: ContScene[], anchorOf: (s: ContScene) => number | undefined = () => undefined): ContIssue[] {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const out: ContIssue[] = [];

  // setups that never pay off, and payoffs that come before any setup, per plotline
  const lines = new Set(ordered.flatMap((s) => [...s.plotSetup, ...s.plotPayoff]));
  for (const line of lines) {
    const setups = ordered.filter((s) => s.plotSetup.includes(line));
    const payoffs = ordered.filter((s) => s.plotPayoff.includes(line));
    for (const s of setups) {
      if (!payoffs.some((p) => p.order > s.order)) out.push({ kind: "unpaid-setup", message: `“${s.title}” sets up “${line}”, but no later scene pays it off.`, path: s.path });
    }
    for (const p of payoffs) {
      if (!setups.some((s) => s.order < p.order)) out.push({ kind: "payoff-first", message: `“${p.title}” pays off “${line}”, but nothing before it sets it up.`, path: p.path });
    }
  }

  // a plotline that goes quiet for a long stretch in the middle of the book
  const byLine = new Map<string, ContScene[]>();
  for (const s of ordered) for (const t of s.tags) byLine.set(t, [...(byLine.get(t) ?? []), s]);
  for (const [line, list] of byLine) {
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].order - list[i - 1].order - 1;
      if (gap >= DORMANT_AFTER) out.push({ kind: "dormant", message: `“${line}” is absent for ${gap} scenes between “${list[i - 1].title}” and “${list[i].title}”.`, path: list[i].path });
    }
  }

  // story dates that run backwards without a flashback or similar marked
  const tl: TimelineScene[] = ordered.map((s) => ({ path: s.path, title: s.title, act: 0, sequence: s.order, storyDate: s.storyDate, storyTime: s.storyTime, mode: parseMode(s.timelineMode) }));
  const withAnchor = (s: ContScene) => parseStoryDate(s.storyDate, anchorOf(s));
  for (const i of backwardJumps(tl.map((t, i) => ({ ...t, storyDate: withAnchor(ordered[i]) ? toIso(withAnchor(ordered[i])!.start) : undefined })))) {
    out.push({ kind: "date-back", message: `“${ordered[i].title}” happens earlier in the story than the scene before it. Mark it as a flashback if that is intended.`, path: ordered[i].path });
  }

  // one character in two places at the same time
  const seen = new Map<string, { scene: ContScene; place: string }>();
  for (const s of ordered) {
    const d = withAnchor(s);
    if (!d || d.precision !== "day" || !s.location.length) continue;
    const place = s.location[0];
    for (const who of new Set([...s.characters, ...(s.pov ? [s.pov] : [])])) {
      const key = `${who}\u0000${d.start}`;
      const prev = seen.get(key);
      if (prev && prev.place !== place && !s.storyTime && !prev.scene.storyTime) {
        out.push({ kind: "two-places", message: `${who} is in “${prev.place}” (“${prev.scene.title}”) and in “${place}” (“${s.title}”) on ${d.display}.`, path: s.path });
      } else if (!prev) seen.set(key, { scene: s, place });
    }
  }
  return out;
}

/** An ISO date for an astronomical time, so the existing date-order check can compare it. */
function toIso(t: number): string {
  const y = Math.floor(t + 1e-9);
  const hist = y >= 1 ? y : y - 1;
  const days = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
  const doy = Math.min(days, Math.floor((t - y) * days + 1e-6) + 1);
  const lens = [31, days === 366 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let m = 0;
  let rem = doy;
  while (m < 11 && rem > lens[m]) rem -= lens[m++];
  return `${hist}-${String(m + 1).padStart(2, "0")}-${String(rem).padStart(2, "0")}`;
}
