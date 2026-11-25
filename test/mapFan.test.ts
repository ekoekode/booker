import { describe, it, expect } from "vitest";
import { clampCentre, fanLayout, stackAround } from "../src/project/mapFan";

describe("fan layout", () => {
  it("is empty for nothing", () => {
    expect(fanLayout(0)).toEqual({ slots: [], radius: 0 });
  });
  it("puts one pin above the centre", () => {
    const f = fanLayout(1);
    expect(f.slots).toEqual([{ dx: 0, dy: -46, ring: 0 }]);
  });
  it("starts at the top and spreads a ring evenly", () => {
    const f = fanLayout(4);
    expect(f.slots).toHaveLength(4);
    expect(f.slots[0]).toMatchObject({ dx: 0, dy: -46 });
    expect(f.slots[1].dx).toBeCloseTo(46, 0);
    expect(f.slots[2].dy).toBeCloseTo(46, 0);
    expect(f.slots.every((s) => s.ring === 0)).toBe(true);
  });
  it("keeps dots at least their spacing apart", () => {
    for (const n of [2, 5, 7, 12, 20, 40]) {
      const { slots } = fanLayout(n, 34);
      expect(slots).toHaveLength(n);
      let min = Infinity;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(slots[i].dx - slots[j].dx, slots[i].dy - slots[j].dy));
      expect(min).toBeGreaterThanOrEqual(30);
    }
  });
  it("starts another ring when one is full, and reports the outer radius", () => {
    const one = fanLayout(8);
    const many = fanLayout(30);
    expect(new Set(one.slots.map((s) => s.ring)).size).toBe(1);
    expect(new Set(many.slots.map((s) => s.ring)).size).toBeGreaterThan(1);
    expect(many.radius).toBeGreaterThan(one.radius);
    for (const s of many.slots) expect(Math.hypot(s.dx, s.dy)).toBeLessThanOrEqual(many.radius);
  });
});

describe("stacks", () => {
  const at = (id: string, x: number, y: number) => ({ id, x, y });
  it("collects the pins within the tolerance of the clicked one, nearest first", () => {
    const a = at("a", 100, 100);
    const all = [a, at("b", 104, 100), at("c", 100, 100), at("far", 160, 100), at("edge", 109, 100), at("out", 110, 100)];
    expect(stackAround(a, all, (p) => p, 9).map((p) => p.id)).toEqual(["a", "c", "b", "edge"]);
  });
  it("is just the pin when it is alone", () => {
    const a = at("a", 0, 0);
    expect(stackAround(a, [a, at("b", 50, 50)], (p) => p)).toEqual([a]);
  });
});

describe("keeping the fan on screen", () => {
  it("moves the centre in from the edges", () => {
    expect(clampCentre(5, 5, 60, 800, 600)).toEqual({ x: 72, y: 72 });
    expect(clampCentre(795, 595, 60, 800, 600)).toEqual({ x: 728, y: 528 });
  });
  it("leaves a centre that already fits", () => {
    expect(clampCentre(400, 300, 60, 800, 600)).toEqual({ x: 400, y: 300 });
  });
  it("respects chrome at the top and bottom, and centres when the area is too small", () => {
    expect(clampCentre(400, 10, 60, 800, 600, 12, 80, 80).y).toBe(152);
    expect(clampCentre(10, 10, 300, 200, 200)).toEqual({ x: 100, y: 100 });
  });
});
