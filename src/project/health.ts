/** Project health: broken citations, footnotes with no partner, scripture references that cannot be found, scene file info that no longer matches the text, and scenes not yet written. Pure. */
import { CITE } from "../citations/cite";
import { scanReferences } from "../scripture/index";
import { formatPassage, type Passage } from "../scripture/ref";
import { BOOK_BY_OSIS } from "../scripture/books";
import { bodyOf, findNames, type Known } from "./detect";
import { pluralEndings } from "../nameVariants";

/** What a scene's properties say, for the checks that compare them with its text. */
export interface SceneFacts {
  status: string;
  /** the POV character is not checked: a first-person scene may never name them */
  pov?: string;
  characters: string[];
  location: string[];
  setup: string[];
  payoff: string[];
}

export interface HealthDoc {
  path: string;
  title: string;
  text: string;
  /** present for scenes, not for front and back matter */
  scene?: SceneFacts;
}

/** The project's codex and scenes, for the checks that look at scene properties. */
export interface HealthContext {
  characters: Known[];
  locations: Known[];
  /** titles and file names of every scene, to check setup and payoff links */
  sceneNames: string[];
  /** statuses that count as not yet written, lower case */
  unfinished: string[];
}

export type HealthGroup = "Citations" | "Footnotes" | "Scripture" | "File info" | "Missing notes" | "Unfinished" | "Files" | "Sequences";

/**
 * A change that fixes a finding: take a name off the scene's properties, or (`create`) make the Codex note a scene names but the book
 * does not have. A new place note takes its coordinates from the scene that names it.
 */
export type Fix = { kind: "characters" | "locations"; name: string } | { kind: "adopt"; label: string } | { kind: "prune"; label: string } | { kind: "create"; entry: "characters" | "locations"; name: string };

export interface Finding {
  group: HealthGroup;
  message: string;
  /** the note to open; empty for a source that is never cited */
  path: string;
  /** 1-based line in that note */
  line: number;
  title: string;
  /** the source's citekey, when the finding is about a source */
  key?: string;
  fix?: Fix;
  /** the project note this finding belongs to (set when several books are scanned together) */
  project?: string;
}

/** A finding's identity, so a dismissed warning stays dismissed while the same problem remains. */
export const findingId = (f: Pick<Finding, "group" | "path" | "message">): string => `${f.group}|${f.path}|${f.message}`;

export interface HealthReport {
  findings: Finding[];
  counts: { verses: number; citations: number; notes: number; sources: number };
}

export const HEALTH_GROUPS: HealthGroup[] = ["Files", "Citations", "Footnotes", "Scripture", "Missing notes", "File info", "Unfinished", "Sequences"];

export interface HealthStats {
  total: number;
  byGroup: Record<HealthGroup, number>;
  /** how many different notes have something to fix */
  notes: number;
}

/** The quick overview of a report: how many warnings there are, in which group and in how many notes. */
export function healthStats(findings: Finding[]): HealthStats {
  const byGroup: Record<HealthGroup, number> = { Citations: 0, Footnotes: 0, Scripture: 0, "File info": 0, "Missing notes": 0, Unfinished: 0, Files: 0, Sequences: 0 };
  for (const f of findings) byGroup[f.group]++;
  return { total: findings.length, byGroup, notes: new Set(findings.filter((f) => f.path).map((f) => f.path)).size };
}

/** "3 warnings: 2 citations, 1 scripture reference", or "No warnings". */
export function describeStats(s: HealthStats): string {
  if (!s.total) return "No warnings";
  const parts = [
    s.byGroup.Files && `${s.byGroup.Files} file${s.byGroup.Files === 1 ? "" : "s"} or structure`,
    s.byGroup.Citations && `${s.byGroup.Citations} citation${s.byGroup.Citations === 1 ? "" : "s"}`,
    s.byGroup.Footnotes && `${s.byGroup.Footnotes} footnote${s.byGroup.Footnotes === 1 ? "" : "s"}`,
    s.byGroup.Scripture && `${s.byGroup.Scripture} scripture reference${s.byGroup.Scripture === 1 ? "" : "s"}`,
    s.byGroup["Missing notes"] && `${s.byGroup["Missing notes"]} missing Codex note${s.byGroup["Missing notes"] === 1 ? "" : "s"}`,
    s.byGroup["File info"] && `${s.byGroup["File info"]} file info`,
    s.byGroup.Unfinished && `${s.byGroup.Unfinished} unfinished`,
    s.byGroup.Sequences && `${s.byGroup.Sequences} sequence problem${s.byGroup.Sequences === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return `${s.total} warning${s.total === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

const DEF = /^\[\^([^\]\[\n]{1,200})\]:/;
const MARK = /\[\^([^\]\[\n]{1,200})\]/g;

/**
 * Look through the text of a book. `exists` says whether a passage is in the Bible module in use (leave it out to skip that check).
 */
export function scanHealth(docs: HealthDoc[], sources: { citekey: string; title: string; library?: boolean }[], exists?: (p: Passage) => boolean, ctx?: HealthContext): HealthReport {
  const findings: Finding[] = [];
  const known = new Set(sources.map((s) => s.citekey));
  const used = new Set<string>();
  const counts = { verses: 0, citations: 0, notes: 0, sources: sources.filter((s) => !s.library).length };
  for (const d of docs) {
    const defs = new Map<string, number>();
    const marks: { label: string; line: number }[] = [];
    const lines = d.text.split("\n");
    lines.forEach((text, i) => {
      const line = i + 1;
      const at = (group: HealthGroup, message: string): Finding => ({ group, message, path: d.path, line, title: d.title });
      const def = DEF.exec(text);
      if (def) {
        if (defs.has(def[1])) findings.push(at("Footnotes", `Footnote [^${def[1]}] is written twice (first on line ${defs.get(def[1])}).`));
        else defs.set(def[1], line);
        counts.notes++;
      }
      for (const m of text.matchAll(MARK)) if (!(def && m.index === 0)) marks.push({ label: m[1], line });
      for (const m of text.matchAll(CITE)) {
        counts.citations++;
        used.add(m[1]);
        if (!known.has(m[1])) findings.push(at("Citations", `No source has the key “${m[1]}”.`));
      }
      for (const p of scanReferences(text)) {
        counts.verses++;
        if (exists && !exists(p)) findings.push(at("Scripture", `${formatPassage(p, BOOK_BY_OSIS.get(p.book)!)} is not in the Bible module.`));
      }
    });
    const marked = new Set<string>();
    for (const m of marks) {
      marked.add(m.label);
      if (!defs.has(m.label)) findings.push({ group: "Footnotes", message: `Footnote mark [^${m.label}] has no note text.`, path: d.path, line: m.line, title: d.title });
    }
    for (const [label, line] of defs) if (!marked.has(label)) findings.push({ group: "Footnotes", message: `Note [^${label}] is never used in the text.`, path: d.path, line, title: d.title });
    if (ctx && d.scene) sceneChecks(d, d.scene, ctx, findings);
  }
  // documents in the library are there to read and look things up in, so one that is never cited is not a problem
  return { findings, counts };
}

const norm = (s: string) => s.trim().toLocaleLowerCase();

/** Every way a name can be written in the text: the name, its aliases and its first name. */
function variants(k: Known): string[] {
  const first = /^(\S{3,})\s+\S/.exec(k.name.trim())?.[1];
  return [k.name, ...(k.aliases ?? []), ...(first ? [first] : [])].map(norm).filter(Boolean);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is this spelling in the text as a whole word, or its plural? ("Ann" is not in "Anna".) */
function appearsIn(lower: string, v: string): boolean {
  const ends = pluralEndings(v);
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(v)}${ends.length ? `(?:${ends.join("|")})?` : ""}(?![\\p{L}\\p{N}_])`, "u").test(lower);
}

const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Properties that disagree with the text, scenes with nothing written, and links to things that are not there. */
function sceneChecks(d: HealthDoc, scene: SceneFacts, ctx: HealthContext, out: Finding[]) {
  const body = bodyOf(d.text);
  const lower = body.toLocaleLowerCase();
  const add = (group: HealthGroup, message: string, fix?: Fix) => out.push({ group, message, path: d.path, line: 1, title: d.title, ...(fix && { fix }) });

  const lookup = (codex: Known[], name: string) => codex.find((k) => norm(k.name) === norm(name) || (k.aliases ?? []).some((a) => norm(a) === norm(name)));
  // the point-of-view character is not checked against the text (a first-person scene may never name them), but still needs a note
  if (scene.pov && !lookup(ctx.characters, scene.pov)) add("Missing notes", `Character “${scene.pov}” (point of view) has no Codex note.`, { kind: "create", entry: "characters", name: scene.pov });

  const check = (kind: "characters" | "locations", names: string[], codex: Known[], label: string) => {
    for (const name of names) {
      const known = lookup(codex, name);
      if (norm(name) === norm(scene.pov ?? "")) continue;
      if (!known) add("Missing notes", `${label} “${name}” in the file info has no Codex note.`, { kind: "create", entry: kind, name });
      const k = known ?? { name };
      const present = findNames(body, [k]).length > 0 || variants(k).some((v) => appearsIn(lower, v));
      if (!present) add("File info", `${label} “${name}” is listed in the file info but no longer appears in the scene.`, { kind, name });
    }
  };
  check("characters", scene.characters, ctx.characters, "Character");
  check("locations", scene.location, ctx.locations, "Place");

  const scenes = new Set(ctx.sceneNames.map(norm));
  for (const [list, what] of [[scene.setup, "Setup"], [scene.payoff, "Payoff"]] as const) {
    for (const name of list) if (!scenes.has(norm(name))) add("File info", `${what} scene “${name}” does not exist.`);
  }

  if (!wordCount(body)) add("Unfinished", "This scene has no text.");
  else if (ctx.unfinished.includes(norm(scene.status))) add("Unfinished", `Still marked “${scene.status}”.`);
}
