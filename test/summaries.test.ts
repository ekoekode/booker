import { describe, it, expect } from "vitest";
import { applySummaryPatch, mergeSummaries, ownSummaryOf } from "../src/project/summaries";

describe("merging scene summaries", () => {
  it("leaves a single scene alone", () => {
    expect(mergeSummaries([{ title: "A", synopsis: "x" }])).toEqual({ drop: [] });
  });
  it("lists every scene's summary, headed by its title", () => {
    const p = mergeSummaries([
      { title: "Arrival", synopsis: "Ann docks.", summary: "Ann docks at dawn." },
      { title: "Escape", synopsis: "She flees." },
      { title: "Empty" },
    ]);
    expect(p.synopsis).toBe("Arrival: Ann docks at dawn.\nEscape: She flees.");
    expect(p.drop).toEqual(expect.arrayContaining(["summary", "summary_ai_short", "summary_ai_words"]));
  });
  it("uses the AI summaries when nothing was written", () => {
    const p = mergeSummaries([{ title: "One", summaryAi: "ai one" }, { title: "Two", summaryAi: "ai two" }]);
    expect(p.synopsis).toBeUndefined();
    expect(p.summary_ai).toBe("One: ai one\nTwo: ai two");
  });
  it("keeps both kinds when there are both", () => {
    const p = mergeSummaries([{ title: "One", synopsis: "mine", summaryAi: "ai" }, { title: "Two", summaryAi: "ai two" }]);
    expect(p.synopsis).toBe("One: mine");
    expect(p.summary_ai).toBe("One: ai\nTwo: ai two");
  });
  it("does nothing to notes with no summaries, except dropping the stale short one", () => {
    const p = mergeSummaries([{ title: "a" }, { title: "b" }]);
    expect(p.synopsis).toBeUndefined();
    expect(p.summary_ai).toBeUndefined();
    expect(p.drop).toContain("summary_ai_short");
  });
  it("applies a patch to frontmatter", () => {
    const fm = { title: "T", summary: "old", summary_ai_short: "short", synopsis: "s1" };
    const out = applySummaryPatch(fm, mergeSummaries([{ title: "One", synopsis: "s1", summary: "old" }, { title: "Two", synopsis: "s2" }]));
    expect(out).toEqual({ title: "T", synopsis: "One: old\nTwo: s2" });
  });
  it("reads a scene's own summary", () => {
    expect(ownSummaryOf({ title: "x", summary: " a  b ", synopsis: "c" })).toBe("a b");
    expect(ownSummaryOf({ title: "x", synopsis: "c" })).toBe("c");
    expect(ownSummaryOf({ title: "x" })).toBe("");
  });
});
