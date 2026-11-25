import { describe, expect, it } from "vitest";
import { markOf, nextMark, runs, withMark } from "../src/project/plotlines";
import { moveInOrder, newSeries, orderBooks, reconcileOrder, parseSeries, seriesCodex, withBook, withoutBook } from "../src/project/series";
import { newProjectFm } from "../src/project/format";
import { orderScenes, type TimelineScene } from "../src/project/timeline";

describe("series", () => {
  it("reads series.json and ignores junk", () => {
    expect(parseSeries({ name: "Saga", bookOrder: ["A", "B"], extra: 1 })?.extra).toBe(1);
    expect(parseSeries({ bookOrder: [] })).toBeNull();
    expect(parseSeries(null)).toBeNull();
  });
  it("adds a book once", () => {
    const m = withBook(withBook(newSeries("Saga", "u", "2026-01-01"), "One", "id1"), "One", "id1");
    expect(m.bookOrder).toEqual(["One"]);
    expect(m.bookIds).toEqual(["id1"]);
  });
  it("orders books by the series list, unlisted ones last", () => {
    const books = [{ name: "C" }, { name: "b" }, { name: "A" }];
    expect(orderBooks(books, ["B", "A"]).map((b) => b.name)).toEqual(["b", "A", "C"]);
  });
  it("shares the Codex at the series folder", () => {
    expect(seriesCodex("S/Saga")).toEqual({ codex: "S/Saga/Codex", characters: "S/Saga/Codex/Characters", locations: "S/Saga/Codex/Locations" });
  });
  it("marks a book as part of a series in its project note", () => {
    expect(newProjectFm("One", "b", "d", "en", { id: "Saga", uuid: "u" })).toMatchObject({ seriesId: "Saga", seriesUuid: "u" });
    expect(newProjectFm("One", "b", "d")).not.toHaveProperty("seriesId");
  });
  it("puts earlier books first in reading order", () => {
    const sc = (title: string, bookRank: number, act: number): TimelineScene => ({ path: title, title, act, sequence: 1, mode: "linear", bookRank });
    expect(orderScenes([sc("b2", 1, 1), sc("b1", 0, 3)], "reading").map((s) => s.title)).toEqual(["b1", "b2"]);
  });
});

describe("plotline marks", () => {
  it("cycles off, scene, setup, payoff, off", () => {
    let m = nextMark("off");
    const seen = [m];
    for (let i = 0; i < 4; i++) seen.push((m = nextMark(m)));
    expect(seen).toEqual(["scene", "setup", "payoff", "off", "scene"]);
  });
  it("reads a mark from the lists, and a mark needs the tag", () => {
    expect(markOf(["a"], ["a"], [], "a")).toBe("setup");
    expect(markOf(["a"], [], ["a"], "a")).toBe("payoff");
    expect(markOf(["a"], [], [], "a")).toBe("scene");
    expect(markOf([], ["a"], [], "a")).toBe("off");
  });
  it("sets one plotline without touching the others", () => {
    const cur = { tags: ["a", "b"], setup: ["b"], payoff: [] };
    expect(withMark(cur, "a", "setup")).toEqual({ tags: ["a", "b"], setup: ["b", "a"], payoff: [] });
    expect(withMark(withMark(cur, "a", "setup"), "a", "payoff")).toEqual({ tags: ["a", "b"], setup: ["b"], payoff: ["a"] });
    expect(withMark(cur, "b", "off")).toEqual({ tags: ["a"], setup: [], payoff: [] });
    expect(withMark({ tags: [], setup: [], payoff: [] }, "x", "scene")).toEqual({ tags: ["x"], setup: [], payoff: [] });
  });
  it("groups columns into runs", () => {
    expect(runs(["a", "a", "b", "a"], (x) => x)).toEqual([{ key: "a", from: 0, to: 1 }, { key: "b", from: 2, to: 2 }, { key: "a", from: 3, to: 3 }]);
  });
});

describe("series manager", () => {
  it("moves a book up or down and stops at the ends", () => {
    expect(moveInOrder(["A", "B", "C"], "B", -1)).toEqual(["B", "A", "C"]);
    expect(moveInOrder(["A", "B", "C"], "B", 1)).toEqual(["A", "C", "B"]);
    expect(moveInOrder(["A", "B"], "A", -1)).toEqual(["A", "B"]);
    expect(moveInOrder(["A", "B"], "B", 1)).toEqual(["A", "B"]);
    expect(moveInOrder(["A"], "Z", 1)).toEqual(["A"]);
  });
  it("reconciles the list with the books that exist", () => {
    expect(reconcileOrder(["One", "Gone", "Two"], ["Two", "One", "Three"])).toEqual(["One", "Two", "Three"]);
  });
});

describe("withoutBook", () => {
  it("drops the folder and id, ignoring case", () => {
    const m = withoutBook({ name: "S", bookOrder: ["A", "B"], bookIds: ["1", "2"], created: "" }, "a", "1");
    expect(m.bookOrder).toEqual(["B"]);
    expect(m.bookIds).toEqual(["2"]);
  });
});
