import { describe, expect, it } from "vitest";
import { planSplit, scenePath } from "../src/project/format";

const F = "StoryLine/B/Scenes";
const sc = (title: string, act: number, chapter: number, sequence: number) => ({ path: scenePath(F, act, sequence, title), title, act, chapter, sequence });

describe("planSplit", () => {
  const scenes = [sc("A", 1, 1, 1), sc("B", 1, 1, 2), sc("C", 1, 2, 3), sc("X", 2, 3, 1)];
  it("puts the new scene right after the split one and shifts the rest of the act", () => {
    const p = planSplit(scenes, scenes[0].path, "New", F)!;
    expect(p.newSequence).toBe(2);
    expect(p.chapter).toBe(1);
    expect(p.ops.map((o) => [o.from, o.patch.sequence])).toEqual([[scenes[1].path, 3], [scenes[2].path, 4]]);
    expect(p.newPath).toBe(scenePath(F, 1, 2, "New"));
  });
  it("needs nothing shifted at the end of an act", () => {
    const p = planSplit(scenes, scenes[2].path, "New", F)!;
    expect(p.ops).toEqual([]);
    expect(p.newSequence).toBe(4);
  });
  it("returns null for an unknown scene", () => {
    expect(planSplit(scenes, "nope", "x", F)).toBeNull();
  });
});
