import { describe, expect, it } from "vitest";
import { bodyOf, oneLine, summaryDue, wordCount } from "../src/generate/background";

describe("summaryDue", () => {
  it("waits for enough words", () => {
    expect(summaryDue(100, undefined)).toBe(false);
    expect(summaryDue(400, undefined)).toBe(true);
  });
  it("summarises again after a good deal of change", () => {
    expect(summaryDue(1000, 950)).toBe(false);
    expect(summaryDue(1000, 700)).toBe(true);
    expect(summaryDue(300, 250)).toBe(false);
    expect(summaryDue(400, 250)).toBe(true);
  });
});

describe("bodyOf", () => {
  it("drops frontmatter and old summary callouts", () => {
    const note = "---\ntype: scene\n---\n> [!summary] Summary\n> - old\n\nThe text itself.";
    expect(bodyOf(note)).toBe("The text itself.");
    expect(wordCount(bodyOf(note))).toBe(3);
  });
  it("keeps a summary on one line", () => {
    expect(oneLine("A.\n\nB.  C.")).toBe("A. B. C.");
  });
});

import { grounded } from "../src/generate/background";
describe("grounded", () => {
  const scene = "The harbor of Sel burned all night, and Mara Voss watched it from the black water with her fingers locked around a broken oar. Kest appeared in a flat boat and held out his hand.";
  it("accepts a summary of the scene", () => {
    expect(grounded("Mara Voss watched the harbor of Sel burn all night. Kest appeared in a boat and held out his hand.", scene)).toBe(true);
  });
  it("refuses an invented one", () => {
    expect(grounded("As a result of the ongoing investigation, the following key points: the main focus is corruption and bribery allegations since 2023.", scene)).toBe(false);
    expect(grounded("Yes.", scene)).toBe(false);
  });
});
