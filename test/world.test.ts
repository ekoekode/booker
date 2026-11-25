import { describe, expect, it } from "vitest";
import { layoutFor } from "../src/project/format";
import { builtinKinds, customKinds, entryFm, slug } from "../src/project/world";

const l = layoutFor("StoryLine", "Novel");

describe("world kinds", () => {
  it("places built-in kinds in StoryLine's folders", () => {
    const k = Object.fromEntries(builtinKinds(l).map((x) => [x.id, x.folder]));
    expect(k.characters).toBe(l.characters);
    expect(k.locations).toBe(l.locations);
    expect(k.items).toBe(`${l.codex}/Items`);
    expect(k.notes).toBe(l.notes);
  });

  it("treats other Codex folders as your own categories, ignoring built-in ones", () => {
    const c = customKinds(l, ["Characters", "items", "Weapons", "Factions"]);
    expect(c.map((x) => x.label)).toEqual(["Factions", "Weapons"]);
    expect(c[0]).toMatchObject({ id: "factions", type: "factions", folder: `${l.codex}/Factions`, custom: true });
  });

  it("writes properties the way StoryLine's codex does", () => {
    const items = builtinKinds(l).find((k) => k.id === "items")!;
    expect(entryFm(items, "Sword", "2026-01-01")).toEqual({ type: "items", name: "Sword", created: "2026-01-01", modified: "2026-01-01", aliases: [], storyDate: "", description: "", color: "" });
    const people = builtinKinds(l).find((k) => k.id === "characters")!;
    expect(Object.keys(entryFm(people, "Mara", "2026-01-01"))).toEqual(expect.arrayContaining(["type", "name", "aliases", "role", "goal", "flaws"]));
    const notes = builtinKinds(l).find((k) => k.id === "notes")!;
    expect(entryFm(notes, "Ideas", "2026-01-01")).toEqual({ type: "note", title: "Ideas", created: "2026-01-01" });
  });

  it("makes ids from names", () => {
    expect(slug("Magic & Rules!")).toBe("magic-rules");
  });
});

import { BUILTIN_PROFILES } from "../src/profiles/profile";
describe("profile world kinds", () => {
  it("fiction keeps every built-in kind and non-fiction swaps in people, places and key terms", () => {
    const fic = BUILTIN_PROFILES.find((p) => p.id === "fiction")!;
    expect(builtinKinds(l, fic.worldKinds).map((k) => k.id)).toEqual(builtinKinds(l).map((k) => k.id));
    const nf = BUILTIN_PROFILES.find((p) => p.id === "nonfiction-christian")!;
    const ids = builtinKinds(l, nf.worldKinds).map((k) => k.id);
    expect(ids).toEqual(["people", "places", "terms", "passages", "notes"]);
    expect(builtinKinds(l, nf.worldKinds)[0].folder).toBe(`${l.codex}/People`);
  });
});
