import { describe, expect, it } from "vitest";
import { actChoices, chapterChoices, newActNumber, newChapterNumber, checklist, continueScene, groupScenes, nextSceneSlot, progress, statusCounts, type HubScene } from "../src/project/hubModel";

const s = (title: string, act: number, chapter: number, sequence: number, words = 0, status = "idea"): HubScene => ({ path: title, title, act, chapter, sequence, words, status });

describe("hub model", () => {
  const scenes = [s("C", 2, 3, 1, 50), s("A", 1, 1, 1, 400, "draft"), s("B", 1, 2, 2, 0)];

  it("groups scenes act then chapter in reading order with word totals", () => {
    const g = groupScenes(scenes);
    expect(g.map((a) => a.act)).toEqual([1, 2]);
    expect(g[0].chapters.map((c) => c.chapter)).toEqual([1, 2]);
    expect(g[0].words).toBe(400);
  });

  it("counts statuses", () => {
    expect(statusCounts(scenes)).toMatchObject({ idea: 2, draft: 1, final: 0 });
  });

  it("puts a new scene after the last one, or in act 1 chapter 1 for an empty book", () => {
    expect(nextSceneSlot(scenes)).toEqual({ act: 2, chapter: 3 });
    expect(nextSceneSlot([])).toEqual({ act: 1, chapter: 1 });
  });

  it("continues at the first empty scene, else the last scene", () => {
    expect(continueScene(scenes)?.title).toBe("B");
    expect(continueScene([s("X", 1, 1, 1, 10)])?.title).toBe("X");
    expect(continueScene([])).toBeNull();
  });

  it("derives the checklist from what exists", () => {
    const start = checklist({ hasProject: true, scenes: [], characters: 0, locations: 0 });
    expect(progress(start)).toMatchObject({ done: 1, total: 5, next: { id: "scene" } });
    const mid = checklist({ hasProject: true, scenes, characters: 1, locations: 0 });
    expect(progress(mid).next?.id).toBe("location");
    expect(progress(checklist({ hasProject: true, scenes, characters: 1, locations: 1 })).next).toBeNull();
  });

  it("offers existing acts and chapters plus the next new ones", () => {
    expect(actChoices(scenes)).toEqual([1, 2]);
    expect(chapterChoices(scenes, 1)).toEqual([1, 2]);
    expect(chapterChoices(scenes, 2)).toEqual([3]);
    expect(newActNumber(scenes)).toBe(3);
    expect(newChapterNumber(scenes)).toBe(4);
    expect(newActNumber([])).toBe(1);
    expect(newChapterNumber([])).toBe(1);
  });
});
