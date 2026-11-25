import { describe, expect, it } from "vitest";
import { breakLines } from "../src/export/linebreak";

const words = (n: number, w = 30) => Array.from({ length: n }, (_, i) => ({ width: w, space: i > 0 }));

describe("breakLines", () => {
  it("fills lines instead of leaving a lone word first", () => {
    const lines = breakLines(words(40), 270, 300, 4);
    expect(lines[0][1] - lines[0][0]).toBeGreaterThanOrEqual(7);
    for (const [a, b] of lines.slice(0, -1)) expect(b - a).toBeGreaterThanOrEqual(7);
  });
  it("covers every box exactly once", () => {
    const lines = breakLines(words(57), 270, 300, 4);
    expect(lines[0][0]).toBe(0);
    expect(lines[lines.length - 1][1]).toBe(57);
    for (let i = 1; i < lines.length; i++) expect(lines[i][0]).toBe(lines[i - 1][1]);
  });
  it("never breaks inside a glued word", () => {
    const boxes = words(40);
    boxes[8].space = false; // box 8 glued to box 7
    for (const [a] of breakLines(boxes, 270, 300, 4)) expect(a === 0 || boxes[a].space).toBe(true);
  });
  it("handles one very short paragraph", () => {
    expect(breakLines(words(1), 270, 300, 4)).toEqual([[0, 1]]);
    expect(breakLines([], 270, 300, 4)).toEqual([]);
  });
  it("avoids lone-word lines when spaces are narrow (real font metrics)", () => {
    // widths measured from Literata 10.5pt, space = 2.1pt, line = 291.6pt
    const w = [18.7, 23.8, 22.4, 25.5, 20.7, 50.7, 23.8, 25.9, 16.6, 14.6, 23.3, 25.4, 18.4, 25.9, 33, 23.8, 30.2, 9.7, 20, 37.1, 16.6, 41.4, 24.6, 14.3, 25.7, 24.6, 23.5, 38.5, 18.5, 24.9, 24.7, 33.1, 19.7, 25, 18, 41.5];
    const boxes = Array.from({ length: 216 }, (_, i) => ({ width: w[i % w.length], space: i > 0 }));
    const lines = breakLines(boxes, 291.6, 291.6, 2.1);
    for (const [a, b] of lines.slice(0, -1)) expect(b - a).toBeGreaterThan(2);
  });
});
