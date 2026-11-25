import { expect, it } from "vitest";
import { checkContinuity, type ContScene } from "../src/project/continuity";
import { timelineAnchor } from "../src/dates";

const sc = (order: number, extra: Partial<ContScene> = {}): ContScene => ({ path: `s${order}`, title: `S${order}`, order, tags: [], plotSetup: [], plotPayoff: [], characters: [], location: [], ...extra });
const kinds = (s: ContScene[], a?: (s: ContScene) => number | undefined) => checkContinuity(s, a).map((i) => i.kind);

it("flags a setup with no later payoff and a payoff with no earlier setup", () => {
  expect(kinds([sc(0, { tags: ["gun"], plotSetup: ["gun"] }), sc(1)])).toEqual(["unpaid-setup"]);
  expect(kinds([sc(0, { tags: ["gun"], plotPayoff: ["gun"] })])).toEqual(["payoff-first"]);
  expect(kinds([sc(0, { tags: ["gun"], plotSetup: ["gun"] }), sc(1, { tags: ["gun"], plotPayoff: ["gun"] })])).toEqual([]);
  expect(kinds([sc(0, { tags: ["gun"], plotPayoff: ["gun"] }), sc(1, { tags: ["gun"], plotSetup: ["gun"] })]).sort()).toEqual(["payoff-first", "unpaid-setup"]);
});
it("flags a plotline that goes quiet for a long stretch", () => {
  const list = [sc(0, { tags: ["love"] }), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => sc(n)), sc(10, { tags: ["love"] })];
  expect(kinds(list)).toEqual(["dormant"]);
  expect(kinds([sc(0, { tags: ["love"] }), sc(3, { tags: ["love"] })])).toEqual([]);
});
it("flags dates that run backwards unless it is marked a flashback", () => {
  expect(kinds([sc(0, { storyDate: "2031-04-05" }), sc(1, { storyDate: "2031-04-02" })])).toEqual(["date-back"]);
  expect(kinds([sc(0, { storyDate: "2031-04-05" }), sc(1, { storyDate: "2031-04-02", timelineMode: "flashback" })])).toEqual([]);
});
it("counts Day N from the timeline start", () => {
  const a = timelineAnchor("2031-04-02");
  expect(kinds([sc(0, { storyDate: "Day 5" }), sc(1, { storyDate: "Day 2" })], () => a)).toEqual(["date-back"]);
});
it("flags one character in two places on the same day", () => {
  const a = sc(0, { storyDate: "2031-04-02", characters: ["Mara"], location: ["Harbor"] });
  const b = sc(1, { storyDate: "2031-04-02", characters: ["Mara"], location: ["Keep"] });
  expect(kinds([a, b])).toEqual(["two-places"]);
  expect(kinds([a, { ...b, storyTime: "dusk" }])).toEqual([]);
  expect(kinds([a, { ...b, storyDate: "2031-04-03" }])).toEqual([]);
  expect(kinds([a, { ...b, location: ["Harbor"] }])).toEqual([]);
});
