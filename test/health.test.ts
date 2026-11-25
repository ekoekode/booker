import { describe, expect, it } from "vitest";
import { scanHealth } from "../src/project/health";
import { removeFromProperties } from "../src/project/detect";

const doc = (text: string, path = "a.md") => ({ path, title: "A", text });
const src = [
  { citekey: "stott", title: "Romans" },
  { citekey: "unused", title: "Never read" },
];

describe("project health", () => {
  it("flags unknown citation keys, but not documents nobody cites", () => {
    const r = scanHealth([doc("Grace [@stott, 12] and [@typo].")], src);
    expect(r.findings.map((f) => f.message)).toEqual(["No source has the key “typo”."]);
    expect(r.counts).toMatchObject({ citations: 2, sources: 2 });
  });
  it("finds footnote marks without text, unused notes and notes written twice", () => {
    const r = scanHealth([doc("One[^1] two[^2].\n\n[^1]: First.\n[^3]: Lost.\n[^1]: Again.")], []);
    const m = r.findings.map((f) => `${f.line}:${f.message}`);
    expect(m).toContain("1:Footnote mark [^2] has no note text.");
    expect(m).toContain("4:Note [^3] is never used in the text.");
    expect(m).toContain("5:Footnote [^1] is written twice (first on line 3).");
  });
  it("checks scripture references against a module when given one", () => {
    const r = scanHealth([doc("See John 3:16 and John 3:99.")], [], (p) => p.from.v !== 99);
    expect(r.findings.map((f) => f.message)).toEqual(["John 3:99 is not in the Bible module."]);
    expect(r.counts.verses).toBe(2);
    expect(scanHealth([doc("See John 3:99.")], []).findings).toEqual([]);
  });
});

import { describeStats, healthStats } from "../src/project/health";
describe("health stats", () => {
  it("counts warnings by group and by note", () => {
    const r = scanHealth([doc("Grace [@typo] and [@typo2]. See John 3:99.[^9]", "a.md"), doc("Also [@typo3].", "b.md")], src, (p) => p.from.v !== 99);
    const s = healthStats(r.findings);
    expect(s.byGroup).toEqual({ Citations: 3, Footnotes: 1, Scripture: 1, "File info": 0, "Missing notes": 0, Unfinished: 0, Files: 0, Sequences: 0 });
    expect(s.total).toBe(5);
    expect(s.notes).toBe(2);
  });
  it("describes them in a short line", () => {
    expect(describeStats(healthStats([]))).toBe("No warnings");
    const one = [{ group: "Scripture" as const, message: "x", path: "a.md", line: 1, title: "A" }];
    expect(describeStats(healthStats(one))).toBe("1 warning: 1 scripture reference");
  });
});

import { citationLines } from "../src/sources/citedIn";
describe("cited in", () => {
  it("lists the lines that cite a key, once each, with the words before", () => {
    const t = "Nothing here.\nGrace is free [@stott, 4] and [@stott, 9].\nOther [@lewis].";
    expect(citationLines(t, "stott")).toEqual([{ line: 2, snippet: "Grace is free" }]);
    expect(citationLines(t, "none")).toEqual([]);
  });
});

import { formatHighlight, parseHighlights, updateHighlight } from "../src/sources/highlights";
describe("changing a highlight", () => {
  it("rewrites just that highlight with its new colour and comment", () => {
    const mk = (uid: string, text: string) => ({ uid, source: "s", loc: "p. 1", text, prefix: "", suffix: "", color: "yellow", created: 1 });
    const md = formatHighlight(mk("a", "first")) + "\n" + formatHighlight(mk("b", "second"));
    const out = updateHighlight(md, { ...mk("b", "second"), color: "blue", comment: "key point" });
    const list = parseHighlights(out);
    expect(list.map((h) => [h.uid, h.color, h.comment])).toEqual([["a", "yellow", undefined], ["b", "blue", "key point"]]);
    expect(out).toContain("Note: key point");
  });
});

describe("scene checks", () => {
  const ctx = {
    characters: [{ name: "Mary Hall", aliases: ["Molly"] }, { name: "Peter" }],
    locations: [{ name: "The Mill" }],
    sceneNames: ["Opening", "Storm"],
    unfinished: ["idea", "outlined"],
  };
  const scene = (text: string, o: Partial<NonNullable<ReturnType<typeof withScene>["scene"]>> = {}) => withScene(text, o);
  function withScene(text: string, o: Record<string, unknown> = {}) {
    return { path: "s.md", title: "S", text, scene: { status: "draft", characters: [], location: [], setup: [], payoff: [], ...o } as any };
  }
  const run = (text: string, o: Record<string, unknown> = {}) => scanHealth([scene(text, o)], [], undefined, ctx).findings.map((f) => `${f.group}: ${f.message}`);

  it("flags a listed character or place the text no longer mentions, with a fix", () => {
    const r = scanHealth([scene("---\ntype: scene\n---\nMolly walked home.", { characters: ["Mary Hall", "Peter"], location: ["The Mill"] })], [], undefined, ctx).findings;
    expect(r.map((f) => f.message)).toEqual([
      "Character “Peter” is listed in the file info but no longer appears in the scene.",
      "Place “The Mill” is listed in the file info but no longer appears in the scene.",
    ]);
    expect(r.map((f) => f.fix)).toEqual([{ kind: "characters", name: "Peter" }, { kind: "locations", name: "The Mill" }]);
  });
  it("counts a name written inside a link, and never judges the POV character", () => {
    expect(run("Then [[Peter]] left.", { characters: ["Peter"] })).toEqual([]);
    expect(run("It was dark.", { characters: ["Peter"], pov: "Peter" })).toEqual([]);
  });
  it("notes names with no Codex note, and setup or payoff scenes that do not exist", () => {
    expect(run("Anna spoke.", { characters: ["Anna"], setup: ["Opening"], payoff: ["Gone"] })).toEqual([
      "Missing notes: Character “Anna” in the file info has no Codex note.",
      "File info: Payoff scene “Gone” does not exist.",
    ]);
  });
  it("offers to create the Codex note for a person or place a scene names, and for the POV character", () => {
    const r = scanHealth([scene("Anna went to the Dock.", { pov: "Zed", characters: ["Anna", "Zed"], location: ["The Dock", "The Mill"] })], [], undefined, ctx).findings;
    const made = r.filter((f) => f.fix?.kind === "create");
    expect(made.map((f) => f.group)).toEqual(["Missing notes", "Missing notes", "Missing notes"]);
    expect(made.map((f) => f.fix)).toEqual([
      { kind: "create", entry: "characters", name: "Zed" },
      { kind: "create", entry: "characters", name: "Anna" },
      { kind: "create", entry: "locations", name: "The Dock" },
    ]);
    expect(made[0].message).toContain("point of view");
    // a known place gets no create offer
    expect(r.some((f) => f.fix?.kind === "create" && f.fix.name === "The Mill")).toBe(false);
  });
  it("flags empty scenes and scenes still at an early status", () => {
    expect(run("---\ntype: scene\n---\n\n")).toEqual(["Unfinished: This scene has no text."]);
    expect(run("Some words here.", { status: "Idea" })).toEqual(["Unfinished: Still marked “Idea”."]);
    expect(run("Some words here.")).toEqual([]);
  });
});

describe("removeFromProperties", () => {
  it("takes names off, keeping the others and the link form", () => {
    const fm: Record<string, any> = { characters: ["[[Mary Hall]]", "[[Peter]]"], location: "[[The Mill]]" };
    expect(removeFromProperties(fm, { characters: ["peter"], locations: ["The Mill"] })).toBe(true);
    expect(fm).toEqual({ characters: ["[[Mary Hall]]"], location: "" });
    expect(removeFromProperties(fm, { characters: ["Nobody"] })).toBe(false);
  });
});

describe("findingId and plural names", () => {
  it("keeps a stable id for the same problem", async () => {
    const { findingId } = await import("../src/project/health");
    const a = { group: "File info" as const, path: "b/Scenes/x.md", message: "Character “Ann” is listed in the file info but no longer appears in the scene." };
    expect(findingId(a)).toBe(findingId({ ...a }));
    expect(findingId(a)).not.toBe(findingId({ ...a, path: "b/Scenes/y.md" }));
  });
  it("does not count Ann as present in Anna, but counts a plural", () => {
    const doc = (text: string) => [{ path: "p.md", title: "S", text, scene: { status: "draft", characters: ["Christian"], location: [], setup: [], payoff: [] } }];
    const ctx = { characters: [{ name: "Christian" }], locations: [], sceneNames: [], unfinished: [] };
    const absent = (text: string) => scanHealth(doc(text), [], undefined, ctx).findings.some((f) => /no longer appears/.test(f.message));
    expect(absent("The Christians gathered at dawn.")).toBe(false);
    expect(absent("Christianity spread quickly.")).toBe(true);
  });
});
