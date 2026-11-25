import { describe, it, expect } from "vitest";
import { boundsOf, centroid, distanceKm, formatCoords, geoFields, parseCoords, readLatLng, toNum, validLatLng } from "../src/project/geo";

describe("geo", () => {
  it("validates ranges", () => {
    expect(validLatLng(48.85, 2.35)).toBe(true);
    expect(validLatLng(91, 0)).toBe(false);
    expect(validLatLng(0, 181)).toBe(false);
    expect(validLatLng(NaN, 0)).toBe(false);
  });
  it("reads numbers and numeric text", () => {
    expect(toNum(3)).toBe(3);
    expect(toNum("48,85")).toBe(48.85);
    expect(toNum("")).toBeNull();
    expect(toNum("abc")).toBeNull();
    expect(toNum(undefined)).toBeNull();
  });
  it("reads a position from frontmatter", () => {
    expect(readLatLng({ geoLat: 48.8566, geoLng: "2.3522" })).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(readLatLng({ geoLat: 48.8566 })).toBeNull();
    expect(readLatLng({ geoLat: 200, geoLng: 0 })).toBeNull();
    expect(readLatLng(undefined)).toBeNull();
  });
  it("parses decimal pairs", () => {
    expect(parseCoords("48.8566, 2.3522")).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(parseCoords("-33.87 151.21")).toEqual({ lat: -33.87, lng: 151.21 });
    expect(parseCoords("40.7;-74")).toEqual({ lat: 40.7, lng: -74 });
  });
  it("parses hemisphere letters and degrees-minutes-seconds", () => {
    expect(parseCoords("40.7N 74.0W")).toEqual({ lat: 40.7, lng: -74 });
    const p = parseCoords(`48°51'24"N 2°21'8"E`)!;
    expect(p.lat).toBeCloseTo(48.8567, 3);
    expect(p.lng).toBeCloseTo(2.3522, 3);
    const s = parseCoords(`33°52'S, 151°12'E`)!;
    expect(s.lat).toBeLessThan(0);
  });
  it("leaves place names and bad ranges alone", () => {
    expect(parseCoords("Paris, France")).toBeNull();
    expect(parseCoords("75001")).toBeNull();
    expect(parseCoords("95, 10")).toBeNull();
    expect(parseCoords("")).toBeNull();
  });
  it("formats and builds frontmatter fields", () => {
    expect(formatCoords({ lat: 48.856614, lng: 2.352222 })).toBe("48.8566, 2.3522");
    expect(geoFields({ lat: 48.8566141, lng: 2.3522219 }, "Paris", "Paris, FR")).toEqual({ address: "Paris", geoLat: 48.85661, geoLng: 2.35222, geoPlace: "Paris, FR" });
    expect(geoFields(null, "")).toEqual({ address: null, geoLat: null, geoLng: null, geoPlace: null });
  });
  it("finds a centre and bounds", () => {
    expect(centroid([])).toBeNull();
    expect(centroid([{ lat: 0, lng: 0 }, { lat: 10, lng: 20 }])).toEqual({ lat: 5, lng: 10 });
    const c = centroid([{ lat: 0, lng: 179 }, { lat: 0, lng: -179 }])!;
    expect(Math.abs(c.lng)).toBeCloseTo(180, 5);
    expect(boundsOf([{ lat: 1, lng: 2 }, { lat: -3, lng: 8 }])).toEqual({ west: 2, south: -3, east: 8, north: 1 });
    expect(boundsOf([])).toBeNull();
  });
  it("measures distance", () => {
    expect(distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 })).toBeGreaterThan(330);
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });
});
