import { textOn } from "../src/project/timelineSources";
import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../src/analysis";
import { buildLanes, candidateSources, deriveSpans, itemColor, matches, parseConfig } from "../src/project/timelineSources";

const item = (id: string, o: Partial<TimelineItem> = {}): TimelineItem => ({
  id, path: id, kind: "scene", label: id, start: 0, end: 1, approx: false, fuzz: 0, open: false, characters: [], plotlines: [], locations: [], book: "Act 1", ...o,
});

describe("timeline sources", () => {
  it("parses a config and drops junk and repeats", () => {
    const c = parseConfig({ sources: [{ kind: "character", name: "Ann", color: "#f00" }, { kind: "character", name: "Ann" }, { kind: "nope", name: "x" }, 5], merge: true, colors: { "kind:scene": "#0f0", bad: 3 } });
    expect(c.sources).toEqual([{ kind: "character", name: "Ann", color: "#f00" }]);
    expect(c.merge).toBe(true);
    expect(c.colors).toEqual({ "kind:scene": "#0f0" });
    expect(parseConfig(null)).toEqual({ sources: [], merge: false, colors: {}, hidden: ["act"] });
  });
  it("matches by character, place, plotline, life and kind", () => {
    const it1 = item("a", { characters: ["Ann"], locations: ["Fort"], plotlines: ["Romance"], lives: ["Ann 2"] });
    expect(matches({ kind: "character", name: "ann" }, it1)).toBe(true);
    expect(matches({ kind: "location", name: "Fort" }, it1)).toBe(true);
    expect(matches({ kind: "plotline", name: "Romance" }, it1)).toBe(true);
    expect(matches({ kind: "life", name: "Ann 2" }, it1)).toBe(true);
    expect(matches({ kind: "kind", name: "life" }, it1)).toBe(false);
    expect(matches({ kind: "all", name: "" }, it1)).toBe(true);
  });
  it("makes a lane per source, sorted by date", () => {
    const items = [item("b", { start: 5, end: 6, characters: ["Ann"] }), item("a", { start: 1, end: 2, characters: ["Ann", "Bo"] }), item("c", { start: 3, end: 4, characters: ["Bo"] })];
    const lanes = buildLanes(items, parseConfig({ sources: [{ kind: "character", name: "Ann" }, { kind: "character", name: "Bo" }] }));
    expect(lanes.map((l) => l.key)).toEqual(["Ann", "Bo"]);
    expect(lanes[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(lanes[1].items.map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("merges into one lane, each item once, coloured by the first source that matches", () => {
    const items = [item("a", { characters: ["Ann", "Bo"] }), item("c", { start: 3, end: 4, characters: ["Bo"] })];
    const lanes = buildLanes(items, parseConfig({ merge: true, sources: [{ kind: "character", name: "Ann", color: "#111" }, { kind: "character", name: "Bo", color: "#222" }] }));
    expect(lanes).toHaveLength(1);
    expect(lanes[0].items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(lanes[0].colors).toEqual(["#111", "#222"]);
  });
  it("colour order: item rule, note colour, source, names, kind", () => {
    const cfg = parseConfig({ colors: { "item:a": "#a", "life:L": "#l", "character:Ann": "#c", "kind:scene": "#k" } });
    expect(itemColor(item("a", { color: "#n" }), cfg)).toBe("#a");
    expect(itemColor(item("b", { color: "#n" }), cfg)).toBe("#n");
    expect(itemColor(item("b"), cfg, { kind: "all", name: "", color: "#s" })).toBe("#s");
    expect(itemColor(item("b", { lives: ["L"], characters: ["Ann"] }), cfg)).toBe("#l");
    expect(itemColor(item("b", { characters: ["Ann"] }), cfg)).toBe("#c");
    expect(itemColor(item("b"), cfg)).toBe("#k");
    expect(itemColor(item("b", { kind: "life" }), cfg)).toBeNull();
  });
  it("leaves out hidden kinds", () => {
    const items = [item("a", { characters: ["Ann"] }), item("b", { kind: "act", characters: ["Ann"] })];
    const lanes = buildLanes(items, parseConfig({ sources: [{ kind: "character", name: "Ann" }] }));
    expect(lanes[0].items.map((i) => i.id)).toEqual(["a"]);
    expect(buildLanes(items, parseConfig({ hidden: [], sources: [{ kind: "character", name: "Ann" }] }))[0].items).toHaveLength(2);
  });
  it("lists candidates", () => {
    const c = candidateSources([item("a", { characters: ["Ann"], plotlines: ["Romance"] })], { characters: ["Bo"], locations: ["Fort"], lives: [] });
    expect(c.map((s) => `${s.kind}:${s.name}`)).toEqual(["all:Everything", "kind:scene", "character:Ann", "character:Bo", "location:Fort", "plotline:Romance"]);
  });
  it("derives chapter and act spans from scenes", () => {
    const scenes = [
      item("s1", { start: 10, end: 11, act: "1", chapter: "1", characters: ["Ann"], lives: ["Ann 1"] }),
      item("s2", { start: 20, end: 25, act: "1", chapter: "2", characters: ["Bo"] }),
      item("s3", { start: 30, end: 31, act: "2", chapter: "2", characters: ["Ann"] }),
    ];
    const spans = deriveSpans(scenes, { act: (a) => `Act ${a}`, chapter: (c) => `Chapter ${c}` });
    const ch2 = spans.find((s) => s.id === "span:chapter:2")!;
    expect([ch2.start, ch2.end, ch2.derived]).toEqual([20, 31, true]);
    expect(ch2.characters.sort()).toEqual(["Ann", "Bo"]);
    expect(spans.find((s) => s.id === "span:act:1")!.lives).toEqual(["Ann 1"]);
    expect(spans.map((s) => s.label).sort()).toEqual(["Act 1", "Act 2", "Chapter 1", "Chapter 2"]);
  });
});

describe("textOn", () => {
  it("picks dark text on light colours and light text on dark ones", () => {
    expect(textOn("#ffffff")).toBe("#000000");
    expect(textOn("#ffd54a")).toBe("#000000");
    expect(textOn("#000000")).toBe("#ffffff");
    expect(textOn("#8e4ec6")).toBe("#ffffff");
    expect(textOn("#fff")).toBe("#000000");
    expect(textOn("nonsense")).toBe("#ffffff");
  });
});

import { buildLanes as bl, parseConfig as pc } from "../src/project/timelineSources";
describe("lives in an Everything lane", () => {
  const mk = (id: string, kind: string, chars: string[], start: number) => ({ id, path: id, kind, label: id, start, end: start + 1, approx: false, fuzz: 0, open: false, characters: chars, plotlines: [], locations: [], book: "", lives: kind === "life" ? [id] : [] }) as any;
  const all = [mk("s1", "scene", ["Ann"], 1), mk("L1", "life", ["Ann"], 1), mk("L2", "life", ["Bo"], 2)];
  it("leaves lives out until their character is added", () => {
    const lanes = bl(all, pc({ sources: [{ kind: "all", name: "Everything" }], hidden: [] }));
    expect(lanes.map((l) => [l.key, l.items.map((i) => i.id)])).toEqual([["Everything", ["s1"]]]);
  });
  it("shows a character's lives in their lane", () => {
    const lanes = bl(all, pc({ sources: [{ kind: "character", name: "Ann" }], hidden: [] }));
    expect(lanes[0].items.map((i) => i.id).sort()).toEqual(["L1", "s1"]);
  });
});
