import { describe, expect, it } from "vitest";
import { backwardJumps, compareChronological, laneKeys, lanes, orderScenes, parseMode, reorder, TimelineScene } from "../src/project/timeline";

const sc = (path: string, o: Partial<TimelineScene> = {}): TimelineScene => ({ path, title: path, act: 1, chapter: 1, sequence: 1, mode: "linear", ...o });

describe("timeline", () => {
  it("reading order follows act, chapter, sequence", () => {
    const l = orderScenes([sc("c", { act: 2 }), sc("b", { sequence: 2 }), sc("a")], "reading");
    expect(l.map((s) => s.path)).toEqual(["a", "b", "c"]);
  });
  it("story order: explicit order first, then dates, then reading", () => {
    const l = orderScenes([sc("d", { storyDate: "2020-05-01" }), sc("c", { storyDate: "2020-01-01", sequence: 9 }), sc("b", { chronologicalOrder: 2 }), sc("a", { chronologicalOrder: 1 }), sc("e", { sequence: 3 })], "chronological");
    expect(l.map((s) => s.path)).toEqual(["a", "b", "c", "d", "e"]);
    expect(compareChronological(sc("x"), sc("y", { storyDate: "1" }))).toBeGreaterThan(0);
  });
  it("reorder numbers every scene and skips unchanged ones", () => {
    const o = [sc("a", { chronologicalOrder: 1 }), sc("b", { chronologicalOrder: 2 }), sc("c", { chronologicalOrder: 3 })];
    expect(reorder(o, 2, 0)).toEqual([{ path: "c", chronologicalOrder: 1 }, { path: "a", chronologicalOrder: 2 }, { path: "b", chronologicalOrder: 3 }]);
    expect(reorder(o, 0, 0)).toEqual([]);
    expect(reorder([sc("a"), sc("b")], 0, 1).length).toBe(2);
  });
  it("flags backwards jumps unless marked", () => {
    const o = [sc("a", { storyDate: "2020-05-01" }), sc("b", { storyDate: "2020-01-01" }), sc("c", { storyDate: "2019-01-01", mode: "flashback" }), sc("d")];
    expect([...backwardJumps(o)]).toEqual([1]);
  });
  it("lanes", () => {
    expect(laneKeys(sc("a"), "pov")).toEqual(["(no POV)"]);
    expect(lanes([sc("a", { pov: "Ann" }), sc("b", { pov: "Bo" }), sc("c", { pov: "Ann" })], "pov")).toEqual(["Ann", "Bo"]);
    expect(laneKeys(sc("a", { tags: ["x", "x", "y"] }), "tag")).toEqual(["x", "y"]);
  });
  it("parses the mode", () => {
    expect(parseMode("flashback")).toBe("flashback");
    expect(parseMode("nope")).toBe("linear");
  });
});
