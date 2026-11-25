import { describe, it, expect } from "vitest";
import { groupByScreen } from "../src/project/mapGroups";

const at = (id: string, x: number, y: number) => ({ id, x, y });
const id = (p: { x: number; y: number }) => p;

describe("grouping pins on screen", () => {
  it("leaves apart pins alone", () => {
    const r = groupByScreen([at("a", 0, 0), at("b", 100, 0), at("c", 0, 100)], id, 14);
    expect(r.groups).toEqual([]);
    expect(r.singles.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("groups pins on the same spot, and places the badge at their mean", () => {
    const r = groupByScreen([at("a", 10, 10), at("b", 10, 10), at("c", 10, 10), at("far", 200, 200)], id);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(r.groups[0]).toMatchObject({ x: 10, y: 10 });
    expect(r.singles.map((p) => p.id)).toEqual(["far"]);
  });
  it("groups pins within the radius, not beyond it", () => {
    const r = groupByScreen([at("a", 0, 0), at("b", 10, 0), at("c", 40, 0)], id, 14);
    expect(r.groups.map((g) => g.members.map((p) => p.id))).toEqual([["a", "b"]]);
    expect(r.singles.map((p) => p.id)).toEqual(["c"]);
  });
  it("uses a different spacing in screen pixels than in map units", () => {
    const wide = (p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 });
    expect(groupByScreen([at("a", 0, 0), at("b", 0.05, 0)], wide, 14).groups).toHaveLength(1);
    expect(groupByScreen([at("a", 0, 0), at("b", 1, 0)], wide, 14).groups).toHaveLength(0);
  });
  it("joins each pin to the nearest badge and handles many pins", () => {
    const pins = Array.from({ length: 300 }, (_, i) => at(String(i), (i % 10) * 3, Math.floor(i / 10) * 300));
    const r = groupByScreen(pins, id, 14);
    expect(r.groups.reduce((n, g) => n + g.members.length, 0) + r.singles.length).toBe(300);
    expect(r.groups).toHaveLength(30);
  });
  it("is empty for nothing", () => {
    expect(groupByScreen([], id)).toEqual({ singles: [], groups: [] });
  });
});
