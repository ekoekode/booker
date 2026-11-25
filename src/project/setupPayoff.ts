export interface LinkScene {
  path: string;
  title: string;
  /** reading position, 0 first */
  order: number;
  /** scenes this one sets up (payoffs listed on a setup scene) */
  payoff: string[];
  /** scenes that set this one up */
  setup: string[];
}

export interface Pair {
  setup: string;
  payoff: string;
}

/**
 * A link is recorded on both ends: the setup scene lists its payoff in `payoff_scenes`, and the payoff scene lists
 * its setup in `setup_scenes`. Either end alone is enough to count.
 */
export function pairs(scenes: LinkScene[]): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  const add = (setup: string, payoff: string) => {
    const k = `${setup}\u0000${payoff}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ setup, payoff });
  };
  for (const s of scenes) {
    for (const p of s.payoff) add(s.title, p);
    for (const u of s.setup) add(u, s.title);
  }
  return out;
}

export type IssueKind = "missing" | "one-way" | "backwards" | "self";

export interface Issue {
  kind: IssueKind;
  message: string;
  setup: string;
  payoff: string;
  /** the scene note that has the problem or can fix it */
  path?: string;
}

/** Problems with the setup and payoff links: a scene that does not exist, a link only one end knows, or a payoff that comes before its setup. */
export function checkLinks(scenes: LinkScene[]): Issue[] {
  const by = new Map(scenes.map((s) => [s.title, s]));
  const out: Issue[] = [];
  for (const { setup, payoff } of pairs(scenes)) {
    const a = by.get(setup);
    const c = by.get(payoff);
    if (setup === payoff) {
      out.push({ kind: "self", message: `“${setup}” is its own setup and payoff.`, setup, payoff, path: a?.path });
      continue;
    }
    if (!a || !c) {
      const gone = !a ? setup : payoff;
      out.push({ kind: "missing", message: `“${gone}” is linked as a ${!a ? "setup" : "payoff"} but there is no scene with that title.`, setup, payoff, path: (a ?? c)?.path });
      continue;
    }
    if (!a.payoff.includes(payoff) || !c.setup.includes(setup)) {
      const lacking = !a.payoff.includes(payoff) ? a : c;
      out.push({ kind: "one-way", message: `“${lacking.title}” does not list the link “${setup}” → “${payoff}” on its side.`, setup, payoff, path: lacking.path });
    }
    if (c.order < a.order) out.push({ kind: "backwards", message: `The payoff “${payoff}” comes before its setup “${setup}”.`, setup, payoff, path: c.path });
  }
  return out;
}

/** A scene's list with `title` added once, or taken out. */
export function withTitle(list: string[], title: string, on: boolean): string[] {
  const rest = list.filter((t) => t !== title);
  return on ? [...rest, title] : rest;
}
