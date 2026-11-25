import { describe, it, expect } from "vitest";
import { gridLines, graticule, niceStep, normaliseGrid, DEFAULT_GRID } from "../src/project/mapGrid";
import { normaliseCoords } from "../src/project/mapCoords";

const c = normaliseCoords({ xMin: 0, xMax: 1000, yMin: 0, yMax: 700 });
const g = { ...DEFAULT_GRID, show: true };
const view = { xMin: 0, xMax: 1000, yMin: 0, yMax: 700 };

describe("grid", () => {
  it("picks round steps", () => {
    expect(niceStep(1000, 8)).toBe(100);
    expect(niceStep(100, 10)).toBe(10);
    expect(niceStep(7, 7)).toBe(1);
    expect(niceStep(0.3, 6)).toBeCloseTo(0.05, 9);
    expect(niceStep(0, 5)).toBe(1);
  });
  it("draws nothing when hidden", () => {
    expect(gridLines(c, view, { ...g, show: false })).toEqual([]);
  });
  it("gives lines inside the map, with labels on majors", () => {
    const lines = gridLines(c, view, { ...g, major: 250 });
    const v = lines.filter((l) => l.axis === "v").map((l) => l.value);
    expect(v).toEqual([0, 250, 500, 750, 1000]);
    const h = lines.filter((l) => l.axis === "h").map((l) => l.value);
    expect(h).toEqual([0, 250, 500]);
    expect(lines.find((l) => l.axis === "v" && l.value === 250)?.label).toBe("250");
    expect(gridLines(c, view, { ...g, major: 250, labels: false }).every((l) => l.label === undefined)).toBe(true);
  });
  it("adds minor lines between majors", () => {
    const lines = gridLines(c, { xMin: 0, xMax: 100, yMin: 0, yMax: 0.0001 }, { ...g, major: 50, minor: 4 });
    const v = lines.filter((l) => l.axis === "v");
    expect(v.map((l) => l.value)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(v.filter((l) => l.major).map((l) => l.value)).toEqual([0, 50, 100]);
  });
  it("only draws what is in view and never a swarm", () => {
    const part = gridLines(c, { xMin: 400, xMax: 600, yMin: 300, yMax: 400 }, { ...g, major: 100 });
    expect(part.filter((l) => l.axis === "v").map((l) => l.value)).toEqual([400, 500, 600]);
    const dense = gridLines(c, view, { ...g, major: 0.001 });
    expect(dense.length).toBeLessThan(600);
  });
  it("auto steps follow the zoom", () => {
    const wide = gridLines(c, view, g).filter((l) => l.axis === "v");
    const close = gridLines(c, { xMin: 400, xMax: 450, yMin: 0, yMax: 700 }, g).filter((l) => l.axis === "v");
    expect(close.length).toBeGreaterThan(3);
    expect(close[1].value - close[0].value).toBeLessThan(wide[1].value - wide[0].value);
  });
  it("draws a graticule in degrees", () => {
    const lines = graticule({ xMin: -180, xMax: 180, yMin: -90, yMax: 90 }, { ...g, major: 30 });
    expect(lines.filter((l) => l.axis === "v")).toHaveLength(13);
    expect(lines.filter((l) => l.axis === "h").every((l) => Math.abs(l.value) <= 85)).toBe(true);
    expect(lines.find((l) => l.axis === "v" && l.value === 30)?.label).toBe("30°");
  });
  it("repairs grid settings", () => {
    expect(normaliseGrid(null)).toEqual(DEFAULT_GRID);
    expect(normaliseGrid({ major: -5, minor: 99, opacity: 7, color: "red" })).toMatchObject({ major: "auto", minor: 20, opacity: 1, color: DEFAULT_GRID.color });
    expect(normaliseGrid({ major: 25, show: true, color: "#abc" })).toMatchObject({ major: 25, show: true, color: "#abc" });
  });
});
