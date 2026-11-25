import { describe, expect, it } from "vitest";
import { planOpen, type PaneInfo, planView } from "../src/openTarget";

const pane = (id: string, x: number, y: number, w = 400, h = 300, isNote = true): PaneInfo => ({ id, x, y, w, h, isNote });

describe("planOpen", () => {
  const hub = pane("hub", 0, 0, 400, 600, false);

  it("same pane reuses the origin", () => {
    expect(planOpen("same", "hub", [hub, pane("a", 400, 0)])).toEqual({ reuse: "hub" });
  });

  it("auto: one pane splits to the right so Booker stays visible", () => {
    expect(planOpen("auto", "hub", [hub])).toEqual({ split: { anchor: "hub", direction: "vertical", before: false } });
  });

  it("auto: with two panes, never reuses the origin and prefers the one already showing a note", () => {
    const blank = pane("blank", 400, 0, 400, 300, false);
    const note = pane("note", 400, 300, 400, 300, true);
    expect(planOpen("auto", "hub", [hub, blank, note])).toEqual({ reuse: "note" });
    expect(planOpen("auto", "hub", [hub, blank])).toEqual({ reuse: "blank" });
  });

  it("right/left reuse the neighbour on that side, else split on that side", () => {
    const right = pane("r", 400, 0, 400, 600);
    expect(planOpen("right", "hub", [hub, right])).toEqual({ reuse: "r" });
    expect(planOpen("left", "hub", [hub, right])).toEqual({ split: { anchor: "hub", direction: "vertical", before: true } });
    expect(planOpen("left", "r", [hub, right])).toEqual({ reuse: "hub" });
  });

  it("top reuses the pane above, else splits above", () => {
    const below = pane("below", 0, 300, 400, 300);
    const above = pane("above", 0, 0, 400, 300);
    expect(planOpen("top", "below", [below, above])).toEqual({ reuse: "above" });
    expect(planOpen("top", "hub", [hub, pane("side", 400, 0)])).toEqual({ split: { anchor: "hub", direction: "horizontal", before: true } });
  });

  it("an unknown origin falls back to itself", () => {
    expect(planOpen("auto", "gone", [hub])).toEqual({ reuse: "gone" });
  });
});


const vpane = (id: string, x: number, w = 500): PaneInfo => ({ id, x, y: 0, w, h: 800, isNote: true });

describe("planOpen first", () => {
  it("uses the leftmost pane", () => {
    expect(planOpen("first", "1", [vpane("0", 600), vpane("1", 100), vpane("2", 900)])).toEqual({ reuse: "1" });
  });
});

describe("planView", () => {
  it("uses the rightmost pane when there are several", () => {
    expect(planView("auto", [vpane("0", 0), vpane("1", 600)], 1200, 1100)).toEqual({ tab: "1" });
  });
  it("splits a single wide pane, tabs a slim one", () => {
    expect(planView("auto", [vpane("0", 0, 1400)], 1400, 1100)).toEqual({ split: { anchor: "0" } });
    expect(planView("auto", [vpane("0", 0, 700)], 700, 1100)).toEqual({ tab: "0" });
  });
  it("honours the always-right and tab modes", () => {
    expect(planView("right", [vpane("0", 0, 700)], 700, 1100)).toEqual({ split: { anchor: "0" } });
    expect(planView("tab", [vpane("0", 0), vpane("1", 600)], 1200, 1100)).toEqual({ tab: "0" });
  });
});
