import { describe, expect, it } from "vitest";
import { parseStoryDate } from "../src/dates";
import {
  groupLanes, LifeData, packRows, PlotlineData, plotStatuses, runLints, SceneData, timelineItems,
} from "../src/analysis";

let n = 0;
function scene(over: Partial<SceneData> = {}): SceneData {
  n++;
  return {
    path: `s${n}.md`, title: `Scene ${n}`, book: "Book 1", order: n, act: "A", chapter: "C", status: "draft",
    words: 500, pov: "Mara", characters: ["Mara"], location: null, lives: [], when: null, whenRaw: "",
    opens: [], advances: [], resolves: [], unresolved: [], ...over,
  };
}
const withDate = (s: string) => ({ when: parseStoryDate(s), whenRaw: s });
const plot = (name: string): PlotlineData => ({ path: `${name}.md`, name, kind: "main", color: null });

describe("plotStatuses", () => {
  it("tracks open, advancing, resolved and never-opened", () => {
    n = 0;
    const scenes = [
      scene({ opens: ["Heist"] }),
      scene({ advances: ["Heist"], opens: ["Romance"] }),
      scene({ resolves: ["Heist"] }),
      scene({ advances: ["Romance"] }),
    ];
    const r = plotStatuses([plot("Heist"), plot("Romance"), plot("Unused")], scenes);
    expect(r[0].state).toBe("resolved");
    expect(r[0].beats.map((b) => b.role)).toEqual(["open", "advance", "resolve"]);
    expect(r[1].state).toBe("advancing");
    expect(r[1].scenesSinceLastTouch).toBe(0);
    expect(r[2].state).toBe("never-opened");
  });
  it("flags dangling, early, repeated and post-resolution beats", () => {
    n = 0;
    const scenes = [
      scene({ advances: ["A"] }),
      scene({ opens: ["A"] }),
      scene({ resolves: ["A"] }),
      scene({ resolves: ["A"] }),
      scene({ advances: ["A"] }),
      scene({ resolves: ["B"] }),
    ];
    const [a, b] = plotStatuses([plot("A"), plot("B")], scenes);
    expect(a.problems.join("|")).toMatch(/before it opens/);
    expect(a.problems.join("|")).toMatch(/Resolved 2 times/);
    expect(a.problems.join("|")).toMatch(/after it was resolved/);
    expect(b.state).toBe("dangling");
  });
  it("counts scenes since the last touch", () => {
    n = 0;
    const scenes = [scene({ opens: ["A"] }), scene(), scene(), scene()];
    expect(plotStatuses([plot("A")], scenes)[0].scenesSinceLastTouch).toBe(3);
  });
});

describe("runLints", () => {
  const life = (over: Partial<LifeData>): LifeData => ({
    path: "l.md", name: "Mara - Life 1", character: "Mara", number: 1, lifeName: null,
    span: { start: 1800, end: 1850 }, howEnded: null, ...over,
  });
  const base = { characters: [{ path: "m.md", name: "Mara" }], plotlines: [] as PlotlineData[] };
  const codes = (ls: ReturnType<typeof runLints>) => ls.map((l) => l.code);

  it("reports missing POV, bad dates, empty finished scenes", () => {
    n = 0;
    const ls = runLints({ ...base, lives: [], scenes: [scene({ pov: null }), scene({ whenRaw: "soon" }), scene({ words: 0 })] });
    expect(codes(ls)).toEqual(expect.arrayContaining(["no-pov", "bad-date", "empty"]));
  });
  it("catches a scene outside the character's life", () => {
    n = 0;
    const ls = runLints({ ...base, lives: [life({})], scenes: [scene(withDate("1900"))] });
    expect(codes(ls)).toContain("outside-life");
  });
  it("accepts a scene inside the life, and ongoing lives", () => {
    n = 0;
    expect(codes(runLints({ ...base, lives: [life({})], scenes: [scene(withDate("1820"))] }))).not.toContain("outside-life");
    expect(codes(runLints({ ...base, lives: [life({ span: { start: 1800, end: Infinity } })], scenes: [scene(withDate("1990"))] }))).not.toContain("outside-life");
  });
  it("asks which life when there are several and the date does not decide", () => {
    n = 0;
    const lives = [life({}), life({ name: "Mara - Life 2", number: 2, path: "l2.md", span: { start: 1900, end: 1950 } })];
    expect(codes(runLints({ ...base, lives, scenes: [scene()] }))).toContain("which-life");
    n = 0;
    expect(codes(runLints({ ...base, lives, scenes: [scene(withDate("1920"))] }))).not.toContain("which-life");
    n = 0;
    expect(codes(runLints({ ...base, lives, scenes: [scene({ lives: ["Mara - Life 2"] })] }))).not.toContain("which-life");
  });
  it("flags a character in two places at once", () => {
    n = 0;
    const ls = runLints({
      ...base, lives: [],
      scenes: [scene({ ...withDate("1847-03-02"), location: "Harbor" }), scene({ ...withDate("1847-03-02"), location: "Keep" })],
    });
    expect(codes(ls)).toContain("two-places");
  });
  it("does not flag different days or loose dates", () => {
    n = 0;
    expect(codes(runLints({ ...base, lives: [], scenes: [scene({ ...withDate("1847-03-02"), location: "A" }), scene({ ...withDate("1847-03-03"), location: "B" })] }))).not.toContain("two-places");
    n = 0;
    expect(codes(runLints({ ...base, lives: [], scenes: [scene({ ...withDate("1800s"), location: "A" }), scene({ ...withDate("1800s"), location: "B" })] }))).not.toContain("two-places");
  });
  it("reports unknown plotlines and unresolved plotlines", () => {
    n = 0;
    const ls = runLints({ ...base, lives: [], plotlines: [plot("Heist")], scenes: [scene({ opens: ["Heist", "Ghost"] })] });
    expect(codes(ls)).toEqual(expect.arrayContaining(["unknown-plotline", "plot-unresolved"]));
  });
});

describe("timeline", () => {
  it("builds items for dated scenes, events, lives and plotline spans", () => {
    n = 0;
    const scenes = [scene({ ...withDate("1800s"), opens: ["Heist"] }), scene({ ...withDate("1850"), resolves: ["Heist"] }), scene()];
    const items = timelineItems({
      scenes, plotlines: [plot("Heist")],
      events: [{ path: "e.md", title: "War", when: parseStoryDate("1812..1815"), characters: [], location: null }],
      lives: [{ path: "l.md", name: "L", character: "Mara", number: 1, lifeName: null, span: { start: 1790, end: Infinity }, howEnded: null }],
    });
    expect(items.filter((i) => i.kind === "scene")).toHaveLength(2);
    const span = items.find((i) => i.kind === "plotline")!;
    expect(span.start).toBe(1800);
    expect(span.end).toBe(1900); // the 1800s scene runs to 1900
    expect(items.find((i) => i.kind === "life")!.open).toBe(true);
  });
  it("groups into lanes by character, with a (none) lane last", () => {
    n = 0;
    const items = timelineItems({
      scenes: [scene({ ...withDate("1800"), characters: ["Mara", "Jo"] }), scene({ ...withDate("1801"), pov: null, characters: [] })],
      events: [], lives: [], plotlines: [],
    });
    const lanes = groupLanes(items, "character");
    expect(lanes.map((l) => l.key)).toEqual(["Jo", "Mara", "(none)"]);
  });
  it("packs overlapping items into separate rows", () => {
    const rows = packRows([{ x0: 0, x1: 50 }, { x0: 10, x1: 60 }, { x0: 55, x1: 70 }, { x0: 100, x1: 120 }]);
    expect(rows).toEqual([0, 1, 0, 0]);
  });
});
