import { describe, expect, it } from "vitest";
import type { HubScene } from "../src/project/hubModel";
import { activityGrid, characterShare, history, historyCsv, locationShare, overview, perAct, perChapter, povShare, readMinutes } from "../src/statsModel";
import { addRecord, MAX_SPRINT_HISTORY, sprintTotals, type SprintRecord } from "../src/sprint";

const sc = (o: Partial<HubScene>): HubScene => ({ path: "p", title: "t", act: 1, chapter: 1, sequence: 1, status: "draft", words: 100, ...o });
const scenes = [
  sc({ title: "a", words: 1000, pov: "Mara", characters: ["Eliot"], location: ["Harbour"] }),
  sc({ title: "b", sequence: 2, words: 500, pov: "Mara", characters: ["Eliot", "Mara"], location: ["Harbour", "Lamp"] }),
  sc({ title: "c", act: 2, chapter: 2, sequence: 1, words: 238, pov: "Eliot" }),
];

describe("statsModel", () => {
  it("adds up the book", () => {
    expect(overview(scenes)).toEqual({ words: 1738, scenes: 3, readMinutes: 7, avgScene: 579 });
    expect(readMinutes(238)).toBe(1);
  });
  it("groups words by act and chapter in reading order", () => {
    expect(perAct(scenes).map((b) => [b.label, b.words, b.scenes])).toEqual([["Act 1", 1500, 2], ["Act 2", 238, 1]]);
    expect(perChapter(scenes).map((b) => [b.label, b.words])).toEqual([["Chapter 1", 1500], ["Chapter 2", 238]]);
  });
  it("shares by pov, character and place", () => {
    expect(povShare(scenes).map((s) => [s.name, s.scenes])).toEqual([["Mara", 2], ["Eliot", 1]]);
    expect(characterShare(scenes)[0]).toEqual({ name: "Eliot", scenes: 3, words: 1738 });
    expect(locationShare(scenes).map((s) => [s.name, s.scenes])).toEqual([["Harbour", 2], ["Lamp", 1]]);
  });
  it("sums the writing history", () => {
    const days = { "2026-10-01": { added: 500, net: 400 }, "2026-10-02": { added: 0, net: 0 }, "2026-10-03": { added: 900, net: 900 } };
    expect(history(days)).toEqual({ added: 1400, deleted: 100, net: 1300, activeDays: 2, bestDay: { key: "2026-10-03", added: 900 } });
    expect(historyCsv(days).split("\n")[1]).toBe("2026-10-01,500,100,400");
  });
  it("lays out twelve weeks, Monday first, empty after today", () => {
    const now = new Date(2026, 9, 28); // a Wednesday
    const g = activityGrid({ "2026-10-26": { added: 70, net: 70 } }, 12, now);
    expect(g).toHaveLength(12);
    expect(g[11][0]).toEqual({ key: "2026-10-26", added: 70 });
    expect(g[11][2]?.key).toBe("2026-10-28");
    expect(g[11][3]).toBeNull();
  });
});

describe("sprint history", () => {
  const now = new Date(2026, 9, 28, 12, 0, 0);
  const at = (d: number, h = 9) => new Date(2026, 9, d, h).getTime();
  const rec = (when: number, words: number, spent: number): SprintRecord => ({ at: when, minutes: 25, words, spent });
  it("totals by period", () => {
    const h = [rec(at(28), 400, 20), rec(at(25), 300, 25), rec(at(1), 200, 10)];
    const t = sprintTotals(h, now);
    expect(t.today).toMatchObject({ count: 1, words: 400, wpm: 20 });
    expect(t.week.count).toBe(2);
    expect(t.month.count).toBe(3);
    expect(t.all.words).toBe(900);
  });
  it("is empty without sprints", () => {
    expect(sprintTotals([], now).all).toEqual({ count: 0, words: 0, minutes: 0, wpm: 0 });
  });
  it("caps the history", () => {
    let h: SprintRecord[] = [];
    for (let i = 0; i < MAX_SPRINT_HISTORY + 5; i++) h = addRecord(h, rec(i, 1, 1));
    expect(h).toHaveLength(MAX_SPRINT_HISTORY);
    expect(h[h.length - 1].at).toBe(MAX_SPRINT_HISTORY + 4);
  });
});
