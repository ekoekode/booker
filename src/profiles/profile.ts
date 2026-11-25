import type { StyleId } from "../citations/styles";
import { BEAT_SHEETS, type BeatSheet } from "../project/beats";
import { PROFILE_SHEETS } from "./beatSheets";

/** A profile describes a kind of book: how it is divided, which tools it uses and what it starts with. It is data, not code. */

export type ViewId = "board" | "plotlines" | "timeline" | "map" | "checks" | "stats" | "family";

export interface Level {
  /** the word for this level, singular and plural */
  id: string;
  singular: string;
  plural: string;
}

export interface WorldKindDef {
  id: string;
  label: string;
  singular: string;
  icon: string;
}

export interface Features {
  scripture: boolean;
  notes: boolean;
  citations: boolean;
  timeline: boolean;
  plotlines: boolean;
  lives: boolean;
  glossary: boolean;
  index: boolean;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  /** outermost first, such as act, chapter, scene */
  levels: Level[];
  statuses: string[];
  worldKinds: WorldKindDef[];
  views: ViewId[];
  features: Features;
  /** front and back matter offered at export, in order */
  frontMatter: string[];
  backMatter: string[];
  /** how its citations are written unless the export says otherwise */
  citationStyle: StyleId;
  /** story or book structures offered for this kind of book */
  beatSheets: BeatSheet[];
}

const none: Features = { scripture: false, notes: false, citations: false, timeline: false, plotlines: false, lives: false, glossary: false, index: false };
const draftStatuses = ["idea", "outlined", "draft", "written", "revised", "final"];
const reviewStatuses = ["idea", "outlined", "draft", "reviewed", "final"];

const lvl = (id: string, plural = `${id}s`): Level => ({ id, singular: id, plural });
const kind = (id: string, label: string, singular: string, icon: string): WorldKindDef => ({ id, label, singular, icon });

const FICTION_KINDS = [
  kind("characters", "Characters", "character", "user"),
  kind("locations", "Places", "place", "map-pin"),
  kind("items", "Items", "item", "package"),
  kind("creatures", "Creatures", "creature", "paw-print"),
  kind("lore", "Lore", "lore entry", "scroll"),
  kind("culture", "Culture", "culture", "landmark"),
  kind("systems", "Systems", "system", "cog"),
];
const PEOPLE_PLACES = [kind("people", "People", "person", "user"), kind("places", "Places", "place", "map-pin"), kind("terms", "Key terms", "term", "book-a")];

export const BUILTIN_PROFILES: Profile[] = [
  {
    id: "fiction",
    name: "Fiction",
    description: "Acts, chapters and scenes, with plotlines, a timeline, characters and lives.",
    levels: [lvl("act"), lvl("chapter"), lvl("scene")],
    statuses: draftStatuses,
    worldKinds: FICTION_KINDS,
    views: ["board", "plotlines", "timeline", "map", "checks", "stats", "family"],
    features: { ...none, timeline: true, plotlines: true, lives: true },
    frontMatter: ["title", "copyright", "dedication", "epigraph"],
    backMatter: ["acknowledgements", "about the author"],
    citationStyle: "chicago",
    beatSheets: BEAT_SHEETS,
  },
  {
    id: "nonfiction-christian",
    name: "Non-fiction: Christian / theology",
    description: "Parts, chapters and sections, with scripture, footnotes, citations and a scripture index.",
    levels: [lvl("part"), lvl("chapter"), lvl("section")],
    statuses: draftStatuses,
    worldKinds: [...PEOPLE_PLACES, kind("passages", "Passages", "passage", "book-open")],
    views: ["board", "timeline", "map", "checks", "stats"],
    features: { ...none, scripture: true, notes: true, citations: true, index: true },
    frontMatter: ["title", "copyright", "dedication", "foreword", "preface", "introduction"],
    backMatter: ["appendix", "notes", "bibliography", "scripture index", "index", "acknowledgements", "about the author"],
    citationStyle: "sbl",
    beatSheets: PROFILE_SHEETS["nonfiction-christian"],
  },
  {
    id: "nonfiction-history",
    name: "Non-fiction: History",
    description: "Parts, chapters and sections, with a timeline, notes, citations and a bibliography.",
    levels: [lvl("part"), lvl("chapter"), lvl("section")],
    statuses: draftStatuses,
    worldKinds: PEOPLE_PLACES,
    views: ["board", "timeline", "map", "checks", "stats"],
    features: { ...none, notes: true, citations: true, timeline: true, index: true },
    frontMatter: ["title", "copyright", "dedication", "preface", "introduction"],
    backMatter: ["appendix", "notes", "bibliography", "index", "acknowledgements"],
    citationStyle: "chicago",
    beatSheets: PROFILE_SHEETS["nonfiction-history"],
  },
  {
    id: "nonfiction-educational",
    name: "Non-fiction: Educational",
    description: "Units, chapters and sections, with key terms, review questions and a glossary.",
    levels: [lvl("unit"), lvl("chapter"), lvl("section")],
    statuses: reviewStatuses,
    worldKinds: [kind("terms", "Key terms", "term", "book-a"), kind("people", "People", "person", "user"), kind("exercises", "Exercises", "exercise", "pencil")],
    views: ["board", "timeline", "map", "checks", "stats"],
    features: { ...none, scripture: true, notes: true, citations: true, glossary: true, index: true },
    frontMatter: ["title", "copyright", "preface", "how to use this book"],
    backMatter: ["answers", "glossary", "bibliography", "index"],
    citationStyle: "apa",
    beatSheets: PROFILE_SHEETS["nonfiction-educational"],
  },
  {
    id: "self-help",
    name: "Self-help",
    description: "Parts, chapters and sections, with exercises and callouts.",
    levels: [lvl("part"), lvl("chapter"), lvl("section")],
    statuses: draftStatuses,
    worldKinds: [kind("exercises", "Exercises", "exercise", "pencil"), kind("stories", "Stories", "story", "message-square"), kind("terms", "Key terms", "term", "book-a")],
    views: ["board", "timeline", "map", "checks", "stats"],
    features: { ...none, notes: true },
    frontMatter: ["title", "copyright", "dedication", "introduction"],
    backMatter: ["resources", "notes", "acknowledgements", "about the author"],
    citationStyle: "chicago",
    beatSheets: PROFILE_SHEETS["self-help"],
  },
  {
    id: "bible-study",
    name: "Bible study / devotional",
    description: "Weeks, days and entries, each with its verses and prompts.",
    levels: [lvl("week"), lvl("day"), lvl("entry", "entries")],
    statuses: draftStatuses,
    worldKinds: [kind("passages", "Passages", "passage", "book-open"), kind("prompts", "Prompts", "prompt", "help-circle")],
    views: ["board", "timeline", "map", "checks", "stats"],
    features: { ...none, scripture: true, notes: true, citations: true },
    frontMatter: ["title", "copyright", "how to use this study"],
    backMatter: ["leader's notes", "notes", "bibliography"],
    citationStyle: "sbl",
    beatSheets: PROFILE_SHEETS["bible-study"],
  },
  {
    id: "sermon",
    name: "Sermon outlines",
    description: "Series, sermons and points, each with its text, illustrations and application.",
    levels: [lvl("series", "series"), lvl("sermon"), lvl("point")],
    statuses: ["idea", "outlined", "draft", "rehearsed", "preached"],
    worldKinds: [kind("passages", "Texts", "text", "book-open"), kind("illustrations", "Illustrations", "illustration", "lightbulb"), kind("applications", "Applications", "application", "footprints")],
    views: ["board", "timeline", "map", "checks", "stats"],
    features: { ...none, scripture: true, notes: true, citations: true },
    frontMatter: ["title", "series overview"],
    backMatter: ["discussion questions", "bibliography"],
    citationStyle: "sbl",
    beatSheets: PROFILE_SHEETS["sermon"],
  },
  {
    id: "reference",
    name: "Reference / encyclopedic",
    description: "Volumes and entries, with cross-references and alphabetical lists.",
    levels: [lvl("volume"), lvl("entry", "entries")],
    statuses: ["stub", "draft", "reviewed", "final"],
    worldKinds: [kind("topics", "Topics", "topic", "tag"), kind("sources", "Sources", "source", "library")],
    views: ["checks", "stats"],
    features: { ...none, notes: true, citations: true, glossary: true, index: true },
    frontMatter: ["title", "copyright", "preface", "how to use this book"],
    backMatter: ["bibliography", "index"],
    citationStyle: "chicago",
    beatSheets: PROFILE_SHEETS["reference"],
  },
  {
    id: "dictionary",
    name: "Dictionary",
    description: "Letters and entries, listed alphabetically.",
    levels: [lvl("letter"), lvl("entry", "entries")],
    statuses: ["stub", "draft", "reviewed", "final"],
    worldKinds: [kind("sources", "Sources", "source", "library")],
    views: ["checks", "stats"],
    features: { ...none, index: true },
    frontMatter: ["title", "copyright", "preface", "how to use this dictionary"],
    backMatter: ["abbreviations", "bibliography"],
    citationStyle: "chicago",
    beatSheets: PROFILE_SHEETS["dictionary"],
  },
];

export const DEFAULT_PROFILE = "fiction";

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const strList = (v: unknown, fallback: string[]): string[] => (Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()) : fallback);

/** Read a profile saved as JSON, filling anything missing from `base` (the Fiction profile unless told otherwise). Returns null if it has no usable id and name. */
export function parseProfile(raw: unknown, base: Profile = BUILTIN_PROFILES[0]): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;
  if (!isStr(o.id) || !isStr(o.name)) return null;
  const levels: Level[] = Array.isArray(o.levels)
    ? o.levels.filter((l: any) => l && isStr(l.id)).map((l: any) => ({ id: String(l.id).toLowerCase(), singular: isStr(l.singular) ? l.singular : String(l.id), plural: isStr(l.plural) ? l.plural : `${l.id}s` }))
    : base.levels;
  if (!levels.length) return null;
  const worldKinds: WorldKindDef[] = Array.isArray(o.worldKinds)
    ? o.worldKinds.filter((k: any) => k && isStr(k.id) && isStr(k.label)).map((k: any) => ({ id: String(k.id), label: String(k.label), singular: isStr(k.singular) ? k.singular : String(k.label).toLowerCase(), icon: isStr(k.icon) ? k.icon : "file-text" }))
    : base.worldKinds;
  const f = o.features && typeof o.features === "object" ? o.features : {};
  const features = { ...base.features };
  for (const key of Object.keys(features) as Array<keyof Features>) if (typeof f[key] === "boolean") features[key] = f[key];
  const views = strList(o.views, base.views) as ViewId[];
  const own = BUILTIN_PROFILES.find((p) => p.id === String(o.id).trim()) ?? base;
  const beatSheets: BeatSheet[] = Array.isArray(o.beatSheets)
    ? o.beatSheets
        .filter((x: any) => x && isStr(x.id) && isStr(x.name) && Array.isArray(x.beats))
        .map((x: any) => {
          const beats = x.beats.filter((y: any) => y && isStr(y.label)).map((y: any) => ({ act: Number(y.act) || 1, label: String(y.label), description: typeof y.description === "string" ? y.description : "" }));
          const labels: Record<number, string> = {};
          for (const [k, v] of Object.entries(x.actLabels ?? {})) if (isStr(v)) labels[Number(k)] = String(v);
          return { id: String(x.id), name: String(x.name), summary: typeof x.summary === "string" ? x.summary : "", actLabels: labels, beats };
        })
    : own.beatSheets;
  return {
    id: String(o.id).trim(),
    name: String(o.name).trim(),
    description: typeof o.description === "string" ? o.description : "",
    levels,
    statuses: strList(o.statuses, base.statuses).length ? strList(o.statuses, base.statuses) : base.statuses,
    worldKinds,
    views,
    features,
    frontMatter: strList(o.frontMatter, base.frontMatter),
    backMatter: strList(o.backMatter, base.backMatter),
    citationStyle: ["chicago", "sbl", "apa", "mla"].includes(o.citationStyle) ? o.citationStyle : base.citationStyle,
    beatSheets,
  };
}

/** The built-in profiles plus the ones saved in the project (`System/profile.json`, one profile or `{ profiles: [...] }`). A saved profile with a built-in id replaces it. */
export function profilesFrom(saved: unknown): Profile[] {
  const list = Array.isArray((saved as any)?.profiles) ? (saved as any).profiles : saved ? [saved] : [];
  const out = new Map(BUILTIN_PROFILES.map((p) => [p.id, p]));
  for (const raw of list) {
    const p = parseProfile(raw);
    if (p) out.set(p.id, p);
  }
  return [...out.values()];
}

let custom: unknown = null;

/** Profiles the user saved in the vault; every part of Booker that lists or looks up profiles sees them through allProfiles(). */
export function setCustomProfiles(saved: unknown) {
  custom = saved;
}

export const allProfiles = (): Profile[] => profilesFrom(custom);

/** Text of a starting file for the user's own profiles, with one worked example. */
export const SAMPLE_PROFILES = JSON.stringify(
  {
    profiles: [
      {
        id: "poetry",
        name: "Poetry collection",
        description: "Sections of poems, with notes and an index.",
        levels: [{ id: "section", singular: "section", plural: "sections" }, { id: "poem", singular: "poem", plural: "poems" }],
        statuses: ["idea", "draft", "revised", "final"],
        worldKinds: [{ id: "themes", label: "Themes", singular: "theme", icon: "sparkles" }],
        views: ["board", "timeline", "map", "checks", "stats"],
        features: { notes: true, index: true },
        frontMatter: ["title", "dedication", "foreword"],
        backMatter: ["notes", "index", "about the author"],
        citationStyle: "chicago",
      },
    ],
  },
  null,
  2
);

/** The statuses a book of this kind moves through, first to last. */
export const statusesFor = (id: unknown): string[] => profileById(allProfiles(), id).statuses;

export function profileById(profiles: Profile[], id: unknown): Profile {
  return profiles.find((p) => p.id === id) ?? profiles.find((p) => p.id === DEFAULT_PROFILE) ?? BUILTIN_PROFILES[0];
}

/** Name of a level for the user, such as "Chapter" or "Chapters". */
export function levelName(p: Profile, depth: number, plural = false): string {
  const l = p.levels[Math.min(Math.max(depth, 0), p.levels.length - 1)];
  const w = plural ? l.plural : l.singular;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Does this profile offer the view? */
export const hasView = (p: Profile, v: ViewId) => p.views.includes(v);
