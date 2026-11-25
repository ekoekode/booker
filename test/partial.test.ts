import { describe, expect, it } from "vitest";
import { cutText, isDrag, isWhole } from "../src/reader/partial";

const full = "For God so loved the world, that he gave his only Son.";

describe("cutText", () => {
  it("marks a cut at the start and the end", () => {
    expect(cutText({ full, start: 4, end: 20 })).toBe("… God so loved the …");
  });
  it("marks only the side that was cut", () => {
    expect(cutText({ full, start: 0, end: 12 })).toBe("For God so l …");
    expect(cutText({ full, start: 28, end: full.length })).toBe("… that he gave his only Son.");
  });
  it("leaves a whole text alone", () => {
    expect(cutText({ full, start: 0, end: full.length })).toBe(full);
    expect(isWhole({ full, start: 0, end: full.length })).toBe(true);
    expect(isWhole({ full, start: 2, end: 9 })).toBe(false);
  });
  it("ignores spaces at the edges", () => {
    expect(cutText({ full: " a b ", start: 0, end: 5 })).toBe("a b");
  });
});

describe("isDrag", () => {
  it("tells a click from a drag", () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
    expect(isDrag({ x: 10, y: 10 }, { x: 40, y: 10 })).toBe(true);
  });
});
