import { describe, it, expect } from "vitest";
import { boundsXY, centroidXY, DEFAULT_COORDS, describeXY, formatXY, fromFraction, inRange, normaliseCoords, parseXY, readPositions, toFraction, withPosition } from "../src/project/mapCoords";

const c = normaliseCoords({ xMin: 0, xMax: 1000, yMin: 0, yMax: 700, yUp: true, unit: "leagues", decimals: 1 });

describe("coordinate systems", () => {
  it("repairs junk", () => {
    expect(normaliseCoords(null)).toEqual(DEFAULT_COORDS);
    expect(normaliseCoords({ xMin: 10, xMax: -10 })).toMatchObject({ xMin: -10, xMax: 10 });
    expect(normaliseCoords({ xMin: 5, xMax: 5 }).xMax).toBe(6);
    expect(normaliseCoords({ xMin: "x" }).xMin).toBe(0);
    expect(normaliseCoords({ decimals: 99 }).decimals).toBe(6);
    expect(normaliseCoords({ xMin: "2,5", xMax: "10" })).toMatchObject({ xMin: 2.5, xMax: 10 });
    expect(normaliseCoords({ yUp: false }).yUp).toBe(false);
  });
  it("maps positions to fractions of the picture and back", () => {
    expect(toFraction(c, { x: 0, y: 700 })).toEqual({ u: 0, v: 0 });
    expect(toFraction(c, { x: 1000, y: 0 })).toEqual({ u: 1, v: 1 });
    const down = normaliseCoords({ xMin: 0, xMax: 100, yMin: 0, yMax: 100, yUp: false });
    expect(toFraction(down, { x: 50, y: 25 })).toEqual({ u: 0.5, v: 0.25 });
    for (const p of [{ x: 412.5, y: 188 }, { x: 0, y: 0 }, { x: 1000, y: 700 }]) {
      const b = fromFraction(c, toFraction(c, p));
      expect(b.x).toBeCloseTo(p.x, 9);
      expect(b.y).toBeCloseTo(p.y, 9);
    }
  });
  it("tells whether a position is on the map", () => {
    expect(inRange(c, { x: 500, y: 700 })).toBe(true);
    expect(inRange(c, { x: 1001, y: 0 })).toBe(false);
    expect(inRange(c, { x: 5, y: -1 })).toBe(false);
  });
  it("parses typed positions", () => {
    expect(parseXY("412.5, 188")).toEqual({ x: 412.5, y: 188 });
    expect(parseXY("412 188")).toEqual({ x: 412, y: 188 });
    expect(parseXY("(12,-3)")).toEqual({ x: 12, y: -3 });
    expect(parseXY("x 10 y 20")).toEqual({ x: 10, y: 20 });
    expect(parseXY("1, 2, 3")).toBeNull();
    expect(parseXY("Paris")).toBeNull();
    expect(parseXY("")).toBeNull();
  });
  it("formats with the map's decimals and unit", () => {
    expect(formatXY(c, { x: 412.456, y: 188 })).toBe("412.5, 188.0");
    expect(describeXY(c, { x: 1, y: 2 })).toBe("1.0, 2.0 leagues");
    expect(describeXY({ ...c, unit: "" }, { x: 1, y: 2 })).toBe("1.0, 2.0");
  });
  it("finds a centre and bounds", () => {
    expect(centroidXY([])).toBeNull();
    expect(centroidXY([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
    expect(boundsXY([{ x: 1, y: 5 }, { x: -2, y: 9 }])).toEqual({ xMin: -2, xMax: 1, yMin: 5, yMax: 9 });
  });
});

describe("mapPos on a note", () => {
  it("reads a list, skipping junk and keeping the last entry per map", () => {
    expect(readPositions(["north: 10, 20", "south: 1.5, 2", "bad", 7, "north: 11, 21", ": 1, 2", "x: nope"])).toEqual([
      { mapId: "north", x: 11, y: 21 },
      { mapId: "south", x: 1.5, y: 2 },
    ]);
    expect(readPositions("a: 1, 2")).toEqual([{ mapId: "a", x: 1, y: 2 }]);
    expect(readPositions(undefined)).toEqual([]);
  });
  it("sets, replaces and removes one map's position", () => {
    let l = withPosition(undefined, "north", { x: 10.123456, y: 20 })!;
    expect(l).toEqual(["north: 10.1235, 20"]);
    l = withPosition(l, "south", { x: 1, y: 2 })!;
    expect(l).toEqual(["north: 10.1235, 20", "south: 1, 2"]);
    l = withPosition(l, "north", { x: 5, y: 5 })!;
    expect(l).toEqual(["south: 1, 2", "north: 5, 5"]);
    expect(withPosition(l, "south", null)).toEqual(["north: 5, 5"]);
    expect(withPosition(["a: 1, 2"], "a", null)).toBeNull();
  });
});
