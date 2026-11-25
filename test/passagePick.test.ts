import { describe, expect, it } from "vitest";
import { nextPick, sortedPicks } from "../src/views/reader/passagePick";

const all = [1, 2, 3, 4, 5, 6];
const none = { picked: new Set<number>(), anchor: null };
const run = (s: typeof none, i: number, shift = false, toggle = false) => nextPick(all, s, i, { shift, toggle });

describe("nextPick", () => {
  it("a plain click picks just that one", () => {
    const s = run(run(none, 2), 4);
    expect(sortedPicks(s.picked)).toEqual([4]);
  });
  it("shift-click picks the range from the anchor", () => {
    expect(sortedPicks(run(run(none, 2), 5, true).picked)).toEqual([2, 3, 4, 5]);
    expect(sortedPicks(run(run(none, 5), 2, true).picked)).toEqual([2, 3, 4, 5]);
  });
  it("cmd-click adds and takes away single passages", () => {
    let s = run(none, 1);
    s = run(s, 4, false, true);
    expect(sortedPicks(s.picked)).toEqual([1, 4]);
    s = run(s, 1, false, true);
    expect(sortedPicks(s.picked)).toEqual([4]);
  });
  it("cmd+shift keeps what is picked and adds the range", () => {
    let s = run(none, 1);
    s = run(s, 3, false, true);
    s = run(s, 6, true, true);
    expect(sortedPicks(s.picked)).toEqual([1, 3, 4, 5, 6]);
  });
  it("shift-click with nothing picked picks one", () => {
    expect(sortedPicks(run(none, 3, true).picked)).toEqual([3]);
  });
});

import { spans } from "../src/views/reader/passagePick";
describe("spans", () => {
  it("joins runs", () => {
    expect(spans([16, 17, 18, 20])).toBe("16-18, 20");
    expect(spans([3])).toBe("3");
    expect(spans([])).toBe("");
  });
});
