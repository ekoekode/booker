import { describe, it, expect } from "vitest";
import { mapChoices, mapById, newMap, parseMaps, resolveMap, slugify, uniqueId, WORLD_ID } from "../src/project/mapsConfig";

describe("maps config", () => {
  it("builds defaults from nothing or junk", () => {
    for (const raw of [null, undefined, 5, "x", [], {}]) {
      const c = parseMaps(raw);
      expect(c.maps).toEqual([]);
      expect(c.realWorld.enabled).toBe(true);
      expect(c.last).toBe(WORLD_ID);
    }
  });
  it("slugs and unique ids", () => {
    expect(slugify("The Northern Reach!")).toBe("north".length ? "the-northern-reach" : "");
    expect(slugify("Ünïcode Ëra")).toBe("unicode-era");
    expect(slugify("???")).toBe("map");
    expect(uniqueId("world", [])).toBe("world-2");
    expect(uniqueId("Reach", ["reach", "reach-2"])).toBe("reach-3");
  });
  it("keeps good maps, drops bad ones, repairs fields", () => {
    const c = parseMaps({
      realWorld: { enabled: false, grid: { show: true, major: 15 } },
      maps: [
        { id: "reach", name: "Reach", image: { path: "System/maps/reach.png", width: 800, height: 600, opacity: 9 }, background: "nope", coords: { xMin: 10, xMax: 0 }, grid: { major: 50 } },
        { id: "reach", name: "Dup" },
        { id: "world", name: "Fake world" },
        { name: "No id" },
        null,
        { id: "bad image", image: { path: "" } },
      ],
      last: "ghost",
    });
    expect(c.realWorld.enabled).toBe(false);
    expect(c.realWorld.grid).toMatchObject({ show: true, major: 15 });
    expect(c.maps.map((m) => m.id)).toEqual(["reach", "no-id", "bad-image"]);
    const r = mapById(c, "reach")!;
    expect(r.image).toEqual({ path: "System/maps/reach.png", width: 800, height: 600, opacity: 1 });
    expect(r.background).toBe("#e9dfc7");
    expect(r.coords).toMatchObject({ xMin: 0, xMax: 10 });
    expect(r.grid.major).toBe(50);
    expect(mapById(c, "bad-image")!.image).toBeNull();
    expect(c.last).toBe(WORLD_ID);
  });
  it("makes new maps with fresh ids", () => {
    const a = newMap("Reach");
    const b = newMap("Reach", [a.id]);
    expect(a.id).toBe("reach");
    expect(b.id).toBe("reach-2");
    expect(a.grid.show).toBe(true);
  });
  it("lists the usable maps and resolves which to show", () => {
    const c = parseMaps({ maps: [{ id: "a", name: "A" }, { id: "b", name: "B" }], last: "b" });
    expect(mapChoices(c).map((m) => m.id)).toEqual(["world", "a", "b"]);
    expect(resolveMap(c)).toBe("b");
    expect(resolveMap(c, "a")).toBe("a");
    expect(resolveMap(c, "nope")).toBe("b");
    const off = parseMaps({ realWorld: { enabled: false }, maps: [{ id: "a", name: "A" }], last: "world" });
    expect(mapChoices(off).map((m) => m.id)).toEqual(["a"]);
    expect(resolveMap(off, "world")).toBe("a");
    expect(resolveMap(parseMaps({ realWorld: { enabled: false } }))).toBeNull();
  });
});
