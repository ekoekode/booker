import { describe, it, expect } from "vitest";
import { BUILTIN_PROFILES, hasView, levelName, parseProfile, profileById, profilesFrom } from "../src/profiles/profile";

describe("profiles", () => {
  it("has unique ids and at least one level each", () => {
    const ids = BUILTIN_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BUILTIN_PROFILES) expect(p.levels.length).toBeGreaterThan(0);
  });
  it("fiction keeps acts, chapters and scenes", () => {
    const f = profileById(BUILTIN_PROFILES, "fiction");
    expect(f.levels.map((l) => l.id)).toEqual(["act", "chapter", "scene"]);
    expect(hasView(f, "plotlines")).toBe(true);
  });
  it("non-fiction Christian turns scripture on and plotlines off", () => {
    const p = profileById(BUILTIN_PROFILES, "nonfiction-christian");
    expect(p.features.scripture).toBe(true);
    expect(hasView(p, "plotlines")).toBe(false);
  });
  it("falls back to fiction for an unknown id", () => {
    expect(profileById(BUILTIN_PROFILES, "nope").id).toBe("fiction");
  });
  it("names levels for the user", () => {
    const p = profileById(BUILTIN_PROFILES, "reference");
    expect(levelName(p, 1, true)).toBe("Entries");
    expect(levelName(p, 5)).toBe("Entry");
  });
  it("reads a saved profile and fills the gaps from fiction", () => {
    const p = parseProfile({ id: "poems", name: "Poetry", levels: [{ id: "section" }, { id: "poem" }], features: { index: true } })!;
    expect(p.levels.map((l) => l.plural)).toEqual(["sections", "poems"]);
    expect(p.features.index).toBe(true);
    expect(p.statuses).toContain("draft");
  });
  it("rejects a saved profile with no id or levels", () => {
    expect(parseProfile({ name: "x" })).toBeNull();
    expect(parseProfile({ id: "x", name: "x", levels: [] })).toBeNull();
    expect(parseProfile(null)).toBeNull();
  });
  it("lets a saved profile replace a built-in one", () => {
    const all = profilesFrom({ profiles: [{ id: "fiction", name: "My fiction", levels: [{ id: "chapter" }] }] });
    expect(profileById(all, "fiction").name).toBe("My fiction");
    expect(all.length).toBe(BUILTIN_PROFILES.length);
  });
});

import { isProject, newProjectFm } from "../src/project/format";
describe("project notes", () => {
  it("accepts old and native project types", () => {
    expect(isProject({ type: "storyline" })).toBe(true);
    expect(isProject({ type: "booker", profile: "reference" })).toBe(true);
    expect(isProject({ type: "scene" })).toBe(false);
  });
  it("names the profile in a new native project", () => {
    const fm = newProjectFm("Book", "id", "2026-10-26", "en", undefined, undefined, "dictionary");
    expect(fm.type).toBe("booker");
    expect(fm.profile).toBe("dictionary");
  });
});

import { SAMPLE_PROFILES, allProfiles, setCustomProfiles } from "../src/profiles/profile";
describe("the user's own profiles", () => {
  it("the sample file is valid and shows up beside the built-in ones", () => {
    setCustomProfiles(JSON.parse(SAMPLE_PROFILES));
    const p = allProfiles().find((x) => x.id === "poetry")!;
    expect(p.name).toBe("Poetry collection");
    expect(p.levels.map((l) => l.id)).toEqual(["section", "poem"]);
    expect(p.features.index).toBe(true);
    expect(allProfiles().length).toBeGreaterThan(BUILTIN_PROFILES.length);
    setCustomProfiles(null);
    expect(allProfiles().length).toBe(BUILTIN_PROFILES.length);
  });
});

import { allProfiles as _all, BUILTIN_PROFILES as _built, parseProfile as _parse } from "../src/profiles/profile";
import { sheetByName as _sheet } from "../src/project/beats";
import { checklist as _check, progress as _prog } from "../src/project/hubModel";

describe("sermon profile, per-profile sheets and checklists", () => {
  it("has a sermon profile with its own outlines", () => {
    const s = _built.find((p) => p.id === "sermon")!;
    expect(s.levels.map((l) => l.id)).toEqual(["series", "sermon", "point"]);
    expect(s.beatSheets.map((x) => x.name)).toContain("Expository sermon");
  });
  it("every built-in profile offers at least one outline, with unique sheet ids", () => {
    const ids = new Set<string>();
    for (const p of _built) {
      expect(p.beatSheets.length, p.id).toBeGreaterThan(0);
      for (const sh of p.beatSheets) {
        expect(ids.has(sh.id), sh.id).toBe(false);
        ids.add(sh.id);
        expect(sh.beats.length).toBeGreaterThan(0);
      }
    }
  });
  it("finds a sheet by name from any profile", () => {
    expect(_sheet("Lesson cycle")?.id).toBe("lesson-cycle");
  });
  it("reads beatSheets from a saved profile and keeps built-in ones when omitted", () => {
    const p = _parse({ id: "x", name: "X", beatSheets: [{ id: "a", name: "A", beats: [{ act: 1, label: "One" }] }] })!;
    expect(p.beatSheets[0].beats[0]).toEqual({ act: 1, label: "One", description: "" });
    expect(_parse({ id: "sermon", name: "Sermons" })!.beatSheets.length).toBeGreaterThan(1);
    expect(_all().length).toBeGreaterThan(8);
  });
  it("gives each kind of book different first steps", () => {
    const base = { hasProject: true, scenes: [], characters: 0, locations: 0, research: { bibles: 0, sources: 0 } };
    const ids = (id: string) => _check({ ...base, profileId: id }).map((s) => s.id).join();
    expect(new Set(["fiction", "sermon", "nonfiction-history", "dictionary", "bible-study"].map(ids)).size).toBe(5);
    expect(_prog(_check({ ...base, profileId: "sermon" })).next?.id).toBe("beats");
    expect(_check({ ...base, profileId: "sermon", beatSheet: true }).find((s) => s.id === "beats")!.done).toBe(true);
  });
});

import { statusesFor as _statuses } from "../src/profiles/profile";
import { statusCounts as _counts } from "../src/project/hubModel";

describe("statuses per kind of book", () => {
  it("each kind has its own list, starting with its first status", () => {
    expect(_statuses("sermon")).toEqual(["idea", "outlined", "draft", "rehearsed", "preached"]);
    expect(_statuses("dictionary")[0]).toBe("stub");
    expect(_statuses("fiction")).toContain("written");
    expect(_statuses("no-such-kind")).toEqual(_statuses("fiction"));
  });
  it("counts scenes against the kind's list", () => {
    const c = _counts([{ status: "preached" }, { status: "preached" }, { status: "idea" }] as any, _statuses("sermon"));
    expect(c).toMatchObject({ preached: 2, idea: 1, rehearsed: 0 });
  });
});
