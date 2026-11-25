import { describe, expect, it } from "vitest";
import { layoutFor } from "../src/project/format";
import { classify, codexFields } from "../src/project/inspectorModel";
import { seriesCodex } from "../src/project/series";

const l = layoutFor("StoryLine", "Novel");

describe("inspector model", () => {
  it("classifies notes by place and type", () => {
    expect(classify(`${l.scenes}/Act 1/01-01 A.md`, { type: "scene" }, l)).toEqual({ kind: "scene" });
    expect(classify(`${l.characters}/Ann.md`, { type: "character" }, l)).toEqual({ kind: "codex", type: "character", group: "character" });
    expect(classify(`${l.locations}/Fort.md`, {}, l)).toEqual({ kind: "codex", type: "location", group: "location" });
    expect(classify(`${l.codex}/Items/Sword.md`, { type: "items" }, l)).toEqual({ kind: "codex", type: "items", group: "other" });
    expect(classify(`${l.codex}/Lives/Ann 1.md`, { type: "life" }, l)).toEqual({ kind: "codex", type: "life", group: "life" });
    expect(classify("Elsewhere/x.md", { type: "scene" }, l)).toEqual({ kind: "none" });
    expect(classify(`${l.scenes}/x.md`, { title: "no type" }, l)).toEqual({ kind: "none" });
  });
  it("classifies a note of a series' shared Codex, which sits outside every book's folder", () => {
    const book = { ...layoutFor("Zz Book Two", "Saga/Zz Book Two"), ...seriesCodex("Saga") };
    expect(classify("Saga/Codex/Characters/Ann.md", { type: "character" }, book)).toEqual({ kind: "codex", type: "character", group: "character" });
    expect(classify("Saga/Codex/Creatures/dog.md", { type: "creatures" }, book)).toEqual({ kind: "codex", type: "creatures", group: "other" });
  });
  it("has fields for each group", () => {
    expect(codexFields("character").some((f) => f.key === "goal")).toBe(true);
    expect(codexFields("location").some((f) => f.key === "atmosphere")).toBe(true);
    expect(codexFields("other").some((f) => f.key === "storyDate")).toBe(true);
    expect(codexFields("life").some((f) => f.key === "howEnded")).toBe(true);
  });
});
