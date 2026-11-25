import { describe, expect, it } from "vitest";
import { makeTicks } from "../src/ticks";

describe("makeTicks", () => {
  it("produces whole-year ticks over centuries", () => {
    const t = makeTicks(1800, 1900, 8);
    expect(t.length).toBeGreaterThan(3);
    expect(t.every((x) => Number.isInteger(x.t))).toBe(true);
    expect(t[0].label).toMatch(/^\d{4}$/);
  });
  it("handles thousands of years across the BCE boundary", () => {
    const t = makeTicks(-5000, 2000, 8);
    expect(t.some((x) => x.label.endsWith("BCE"))).toBe(true);
    expect(t.some((x) => !x.label.endsWith("BCE"))).toBe(true);
  });
  it("handles deep time", () => {
    const t = makeTicks(-1_000_000, 10_000, 8);
    expect(t.length).toBeGreaterThan(3);
    expect(t[0].label).toMatch(/BCE/);
  });
  it("switches to months for a year or two", () => {
    const t = makeTicks(1847, 1848, 8);
    expect(t.length).toBeGreaterThanOrEqual(6);
    expect(t.some((x) => /Mar|Jun/.test(x.label))).toBe(true);
  });
  it("switches to days for a few weeks", () => {
    const t = makeTicks(1847.17, 1847.2, 8);
    expect(t.length).toBeGreaterThan(2);
    expect(t[0].label).toMatch(/Mar/);
  });
  it("returns nothing for an empty range", () => {
    expect(makeTicks(5, 5)).toEqual([]);
  });
});
