import { describe, it, expect } from "vitest";
import { layoutFamily, parseFamily } from "../src/project/family";

const P = (name: string, parents: string[] = [], partners: string[] = []) => ({ name, parents, partners });

describe("family layout", () => {
  const people = [P("Gran"), P("Grandad", [], ["Gran"]), P("Mum", ["Gran", "Grandad"]), P("Dad", [], ["Mum"]), P("Kid", ["Mum", "Dad"]), P("Loner"), P("Cousin", ["Gran"])];
  const l = layoutFamily(people);
  const at = (n: string) => l.placed.find((p) => p.name === n)!;
  it("puts children a generation below their parents", () => {
    expect(at("Gran").gen).toBe(0);
    expect(at("Mum").gen).toBe(1);
    expect(at("Kid").gen).toBe(2);
  });
  it("puts a partner level with their other half, even without parents", () => {
    expect(at("Dad").gen).toBe(1);
  });
  it("sets people with no links apart", () => {
    expect(l.unconnected).toEqual(["Loner"]);
    expect(l.placed.find((p) => p.name === "Loner")).toBeUndefined();
  });
  it("makes partner links two-way and lists each couple once", () => {
    expect(l.couples.length).toBe(2);
  });
  it("never puts two people on one spot", () => {
    const keys = l.placed.map((p) => `${p.gen}:${p.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("limits a tree to its members", () => {
    const t = layoutFamily(people, ["Mum", "Kid", "Loner"]);
    expect(t.placed.map((p) => p.name).sort()).toEqual(["Kid", "Mum"]);
    expect(t.unconnected).toEqual(["Loner"]);
  });
  it("survives a loop", () => {
    const t = layoutFamily([P("A", ["B"]), P("B", ["A"])]);
    expect(t.placed.length).toBe(2);
  });
  it("reads a saved file", () => {
    expect(parseFamily({ trees: [{ id: "x", name: "Court", members: ["A"] }, 5] }).trees).toHaveLength(1);
    expect(parseFamily(null).trees).toEqual([]);
  });
});
