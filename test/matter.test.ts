import { describe, expect, it } from "vitest";
import { matterFileName, matterPlan, nextMatterIndex, sortMatter, swapMatterNames, titleCase } from "../src/project/matter";
import { BUILTIN_PROFILES, profileById } from "../src/profiles/profile";

describe("front and back matter", () => {
  it("leaves out what the export makes itself and keeps the order", () => {
    const p = profileById(BUILTIN_PROFILES, "nonfiction-christian");
    const plan = matterPlan(p.frontMatter, p.backMatter);
    expect(plan.some((m) => /title|copyright|bibliography/i.test(m.title))).toBe(false);
    expect(plan.filter((m) => m.position === "front").length).toBeGreaterThan(0);
    expect(plan.findIndex((m) => m.position === "back")).toBeGreaterThan(plan.findIndex((m) => m.position === "front"));
  });
  it("names and sorts notes", () => {
    expect(titleCase("how to use this book")).toBe("How to Use This Book");
    expect(matterFileName(0, "Foreword")).toBe("01 Foreword.md");
    expect(matterFileName(9, "A/B")).toBe("10 A-B.md");
    const list = sortMatter([
      { position: "back", path: "B/Back/02 Index.md" },
      { position: "front", path: "B/Front/10 Preface.md" },
      { position: "front", path: "B/Front/02 Foreword.md" },
      { position: "back", path: "B/Back/01 Appendix.md" },
    ]);
    expect(list.map((x) => x.path.split("/").pop())).toEqual(["02 Foreword.md", "10 Preface.md", "01 Appendix.md", "02 Index.md"]);
    expect(nextMatterIndex(["01 A.md", "03 B.md"])).toBe(3);
  });
});

describe("matter reordering", () => {
  it("trades numbers between neighbours", () => {
    expect(swapMatterNames("01 Foreword.md", "02 Preface.md")).toEqual(["02 Foreword.md", "01 Preface.md"]);
    expect(swapMatterNames("Foreword.md", "02 Preface.md")).toBeNull();
  });
});
