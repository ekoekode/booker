import { describe, expect, it } from "vitest";
import { branchFrom, buildMap, connectors, dropLine, joinLines, laneOrder, lineEnd, parsePlotlines, wouldLoop } from "../src/project/plotlines";

const empty = () => parsePlotlines(null);

describe("plotline relations", () => {
  it("keeps relations and joins from the file and drops broken ones", () => {
    const f = parsePlotlines({ relations: { b: { parent: "a", at: "s1", kind: "split" }, c: { parent: "c", at: "s1" }, d: { at: "x" } }, joins: [{ from: "a", to: "b", at: "s2" }, { from: "a", to: "a", at: "s2" }, 4] });
    expect(f.relations).toEqual({ b: { parent: "a", at: "s1", kind: "split" } });
    expect(f.joins).toEqual([{ from: "a", to: "b", at: "s2" }]);
    expect(empty().relations).toEqual({});
  });
  it("refuses loops", () => {
    const rel = { b: { parent: "a", at: "s", kind: "branch" as const }, c: { parent: "b", at: "s", kind: "branch" as const } };
    expect(wouldLoop(rel, "a", "c")).toBe(true);
    expect(wouldLoop(rel, "c", "a")).toBe(false);
    const f = { ...empty(), relations: rel };
    expect(branchFrom(f, "c", "a", "s", "branch", "#000")).toBe(f);
    expect(branchFrom(f, "a", "a", "s", "branch", "#000")).toBe(f);
  });
  it("puts subplots under their parent", () => {
    const rel = { x: { parent: "a", at: "s", kind: "branch" as const }, y: { parent: "x", at: "s", kind: "split" as const } };
    expect(laneOrder(["a", "b", "x", "y"], rel).map((l) => `${l.tag}${l.depth}`)).toEqual(["a0", "x1", "y2", "b0"]);
    expect(laneOrder(["a", "b", "x", "y"], rel, new Set(["a"])).map((l) => l.tag)).toEqual(["a", "b"]);
    expect(laneOrder(["a", "x"], rel)[0].parent).toBe(true);
  });
  it("orders map lanes and draws connectors", () => {
    const scenes = [{ path: "s1", tags: ["a"] }, { path: "s2", tags: ["a", "x"] }, { path: "s3", tags: ["b", "x"] }];
    const rel = { x: { parent: "a", at: "s2", kind: "split" as const } };
    const m = buildMap(scenes, {}, [], laneOrder(["a", "b", "x"], rel).map((l) => l.tag));
    expect(m.lines.map((l) => l.tag)).toEqual(["a", "x", "b"]);
    const idx = (p: string) => scenes.findIndex((s) => s.path === p);
    const c = connectors(m, rel, [{ from: "x", to: "b", at: "s3" }], idx);
    expect(c[0]).toMatchObject({ fromLane: 0, toLane: 1, fromAt: 1, toAt: 1, kind: "split" });
    expect(c[1]).toMatchObject({ fromLane: 1, toLane: 2, fromAt: 2, toAt: 2, kind: "join" });
    expect(lineEnd("a", m.lines[0].stops, rel, idx)).toBe(1);
    expect(lineEnd("b", m.lines[2].stops, rel, idx)).toBe(2);
  });
  it("adds joins once and drops a plotline cleanly", () => {
    let f = branchFrom(empty(), "a", "x", "s", "branch", "#111");
    expect(f.tagColors.x).toBe("#111");
    f = joinLines(joinLines(f, "x", "a", "s2"), "x", "a", "s2");
    expect(f.joins).toHaveLength(1);
    const g = dropLine(f, "a");
    expect(g.relations).toEqual({});
    expect(g.joins).toEqual([]);
    expect(g.tagColors.x).toBe("#111");
  });
});
