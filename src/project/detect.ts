import { buildMatcher, findInsertions, MatchCase, NameEntry } from "../autolinkCore";
import { linkList, wrapLink } from "./format";

/** A character or place from the project's codex: its name, and other names it goes by. */
export interface Known {
  name: string;
  aliases?: string[];
}

export interface Found {
  characters: string[];
  locations: string[];
}

/** Something found that could be more than one note: "Mike" when both Mike Anderson and Mike Johnson exist. */
export interface Ask {
  /** the word as it is written in the scene */
  text: string;
  kind: "characters" | "locations";
  options: string[];
}

export interface Analysis {
  names: string[];
  ask: Ask[];
}

const FIRST_NAME = /^(\S{3,})\s+\S/;

/** Every way a name can be written, with the notes each one could mean. First names count, so "Mike" can mean either Mike. */
function spellings(list: Known[]): Map<string, { text: string; targets: string[]; own: boolean }> {
  const out = new Map<string, { text: string; targets: string[]; own: boolean }>();
  const put = (text: string, target: string, own: boolean) => {
    const k = text.toLocaleLowerCase();
    const e = out.get(k) ?? { text, targets: [], own };
    if (!e.targets.includes(target)) e.targets.push(target);
    e.own = e.own || own;
    out.set(k, e);
  };
  for (const k of list) {
    const name = k.name.trim();
    if (!name) continue;
    put(name, name, true);
    for (const a of (k.aliases ?? []).slice(0, 40)) if (typeof a === "string" && a.trim()) put(a.trim(), name, false);
    const first = FIRST_NAME.exec(name)?.[1];
    if (first) put(first, name, false);
  }
  return out;
}

/**
 * Names from the codex that appear in the text, in order of appearance. A word that fits more than one note is not
 * guessed: it comes back in `ask`, unless one of its notes is already in `present` (then you have answered it).
 * Text inside links, code and comments is ignored.
 */
export function analyze(text: string, list: Known[], matchCase: MatchCase = "ignore", present: string[] = []): Analysis {
  const sp = spellings(list);
  const sure: NameEntry[] = [];
  const unsure: { text: string; targets: string[] }[] = [];
  const have = new Set(present.map((p) => p.toLocaleLowerCase()));
  for (const e of sp.values()) {
    if (e.targets.length === 1) sure.push({ name: e.text, target: e.targets[0], own: e.own });
    else if (!e.targets.some((t) => have.has(t.toLocaleLowerCase()))) unsure.push(e);
  }
  const names: string[] = [];
  const spans: { from: number; to: number }[] = [];
  const matcher = buildMatcher(sure, { matchCase });
  if (matcher) {
    for (const ins of findInsertions(text, matcher, { mode: "every" })) {
      spans.push(ins);
      const m = /^\[\[([^\]|]+)/.exec(ins.replacement);
      if (m && !names.includes(m[1])) names.push(m[1]);
    }
  }
  const ask: Ask[] = [];
  const mu = buildMatcher(unsure.map((u) => ({ name: u.text, target: u.text })), { matchCase });
  if (mu) {
    for (const ins of findInsertions(text, mu, { mode: "first" })) {
      // "Mike" inside "Mike Anderson" is the longer name, not a question
      if (spans.some((r) => ins.from < r.to && ins.to > r.from)) continue;
      const shown = text.slice(ins.from, ins.to);
      const u = unsure.find((x) => x.text.toLocaleLowerCase() === shown.toLocaleLowerCase());
      if (u && !ask.some((a) => a.text.toLocaleLowerCase() === shown.toLocaleLowerCase())) ask.push({ text: shown, kind: "characters", options: u.targets });
    }
  }
  return { names, ask };
}

/** Names from the codex that appear in the text, in the order they first appear. Questions are left out. */
export function findNames(text: string, list: Known[], matchCase: MatchCase = "ignore"): string[] {
  return analyze(text, list, matchCase).names;
}

/** The scene's text without its properties block. */
export function bodyOf(doc: string): string {
  if (!doc.startsWith("---")) return doc;
  const end = doc.indexOf("\n---", 3);
  return end < 0 ? doc : doc.slice(end + 4);
}

export interface Detection extends Found {
  ask: Ask[];
}

/** What the scene mentions. `present` are the names already in its properties, which settle any question about them. */
export function detect(doc: string, characters: Known[], locations: Known[], matchCase: MatchCase = "ignore", present: { characters?: string[]; locations?: string[] } = {}): Detection {
  const body = bodyOf(doc);
  const c = analyze(body, characters, matchCase, present.characters);
  const l = analyze(body, locations, matchCase, present.locations);
  return {
    characters: c.names,
    locations: l.names,
    ask: [...c.ask.map((a) => ({ ...a, kind: "characters" as const })), ...l.ask.map((a) => ({ ...a, kind: "locations" as const }))],
  };
}

/**
 * Add what was found to a scene's properties. Only adds: names already there, the POV character and anything you set by
 * hand stay as they are, and the text of the scene is never touched. Returns true when something was added.
 */
export function addToProperties(fm: Record<string, any>, found: Found): boolean {
  let changed = false;
  const have = linkList(fm.characters).map((n) => n.toLowerCase());
  const pov = linkList(fm.pov).map((n) => n.toLowerCase());
  const add = found.characters.filter((n) => !have.includes(n.toLowerCase()) && !pov.includes(n.toLowerCase()));
  if (add.length) {
    const existing = Array.isArray(fm.characters) ? fm.characters : linkList(fm.characters).map(wrapLink);
    fm.characters = [...existing, ...add.map(wrapLink)];
    changed = true;
  }
  // the location property holds one place, so a place you chose is never replaced
  if (found.locations.length && linkList(fm.location).length === 0) {
    fm.location = wrapLink(found.locations[0]);
    changed = true;
  }
  return changed;
}

/** Take names off a scene's properties: the opposite of `addToProperties`. Returns true when something was removed. */
export function removeFromProperties(fm: Record<string, any>, gone: { characters?: string[]; locations?: string[] }): boolean {
  let changed = false;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const chars = gone.characters ?? [];
  if (chars.length && fm.characters != null) {
    const list: unknown[] = Array.isArray(fm.characters) ? fm.characters : linkList(fm.characters).map(wrapLink);
    const kept = list.filter((v) => !chars.some((c) => same(linkList(v)[0] ?? "", c)));
    if (kept.length !== list.length) {
      fm.characters = kept;
      changed = true;
    }
  }
  const places = gone.locations ?? [];
  if (places.length && linkList(fm.location).some((l) => places.some((p) => same(l, p)))) {
    fm.location = "";
    changed = true;
  }
  return changed;
}
