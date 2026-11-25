import { describe, it, expect } from "vitest";
import { buildPins, chapterKey, dateExtent, emptyFilter, facets, filterPins, type PinRecord } from "../src/project/mapData";

type OldRec = Partial<Omit<PinRecord, "positions">> & { id: string; own?: { lat: number; lng: number } | null; on?: Record<string, { x: number; y: number }> };
/** a record with an optional real-world position (`own`) and positions on other maps (`on`) */
const rec = (o: OldRec): PinRecord => {
  const { own, on, ...rest } = o;
  const positions = [...(own ? [{ mapId: "world", x: own.lng, y: own.lat }] : []), ...Object.entries(on ?? {}).map(([mapId, p]) => ({ mapId, ...p }))];
  return { path: `${o.id}.md`, kind: "scene", label: o.id, positions, places: [], start: null, end: null, characters: [], plotlines: [], book: "", ...rest };
};

const records: PinRecord[] = [
  rec({ id: "Codex/Locations/Paris", kind: "location", label: "Paris", own: { lat: 48.85, lng: 2.35 } }),
  rec({ id: "Codex/Locations/Rome", kind: "location", label: "Rome", own: { lat: 41.9, lng: 12.5 } }),
  rec({ id: "Codex/Locations/Nowhere", kind: "location", label: "Nowhere" }),
  rec({ id: "s1", label: "Arrival", places: ["Paris"], start: 100, end: 101, characters: ["Ann"], plotlines: ["Heist"], chapter: "1", chapterTitle: "Chapter 1", book: "B1" }),
  rec({ id: "s2", label: "Escape", places: ["Rome"], start: 200, end: 200, characters: ["Bob"], chapter: "1", chapterTitle: "Chapter 1", book: "B1" }),
  rec({ id: "s3", label: "Own spot", own: { lat: 10, lng: 10 }, places: ["Paris"], start: 300, end: 300, chapter: "2", book: "B1" }),
  rec({ id: "s4", label: "Lost", places: ["Nowhere"], start: 400, end: 400 }),
  rec({ id: "s5", label: "Undated", places: ["Rome"] }),
  rec({ id: "n1", kind: "event", label: "Coronation", own: { lat: 0, lng: 0 }, start: 150, end: 160 }),
];

describe("map pins", () => {
  const pins = buildPins(records);
  const byId = (id: string) => pins.find((p) => p.id === id)!;
  it("takes a position from the note itself, else from a linked place", () => {
    expect(byId("s1")).toMatchObject({ y: 48.85, x: 2.35, source: "place", placeName: "Paris" });
    expect(byId("s3")).toMatchObject({ y: 10, x: 10, source: "own" });
  });
  it("leaves out notes with no position anywhere", () => {
    expect(pins.find((p) => p.id === "s4")).toBeUndefined();
    expect(pins.find((p) => p.id === "Codex/Locations/Nowhere")).toBeUndefined();
  });
  it("puts a chapter at the centre of its scenes", () => {
    const ch = pins.find((p) => p.kind === "chapter" && p.label === "Chapter 1")!;
    expect(ch.y).toBeCloseTo((48.85 + 41.9) / 2, 5);
    expect(ch.start).toBe(100);
    expect(ch.end).toBe(200);
    expect(ch.characters.sort()).toEqual(["Ann", "Bob"]);
    expect(pins.filter((p) => p.kind === "chapter")).toHaveLength(2);
  });
  it("keeps undated pins", () => {
    expect(byId("s5").start).toBeNull();
  });
});

describe("map filters", () => {
  const pins = buildPins(records).filter((p) => p.kind !== "chapter");
  it("finds the dated extent", () => {
    expect(dateExtent(pins)).toEqual([100, 300]);
    expect(dateExtent([])).toBeNull();
  });
  it("filters by date window, keeping undated pins unless told not to", () => {
    const f = { ...emptyFilter(), range: [140, 220] as [number, number] };
    const ids = filterPins(pins, f).map((p) => p.id).sort();
    expect(ids).toEqual(["Codex/Locations/Paris", "Codex/Locations/Rome", "n1", "s2", "s5"].sort());
    expect(filterPins(pins, { ...f, undated: false }).map((p) => p.id)).not.toContain("s5");
  });
  it("counts a range that only touches a pin's span", () => {
    expect(filterPins(pins, { ...emptyFilter(), range: [160, 170], undated: false }).map((p) => p.id)).toEqual(["n1"]);
    expect(filterPins(pins, { ...emptyFilter(), range: [101, 101], undated: false }).map((p) => p.id)).toEqual(["s1"]);
  });
  it("filters by kind, character, plotline, book and text", () => {
    expect(filterPins(pins, { ...emptyFilter(), hidden: new Set(["scene"]) }).every((p) => p.kind !== "scene")).toBe(true);
    expect(filterPins(pins, { ...emptyFilter(), characters: ["Ann"] }).map((p) => p.id)).toEqual(["s1"]);
    expect(filterPins(pins, { ...emptyFilter(), plotlines: ["Heist"] }).map((p) => p.id)).toEqual(["s1"]);
    expect(filterPins(pins, { ...emptyFilter(), books: ["B1"] }).map((p) => p.id).sort()).toEqual(["s1", "s2", "s3"]);
    expect(filterPins(pins, { ...emptyFilter(), text: "coron" }).map((p) => p.id)).toEqual(["n1"]);
    expect(filterPins(pins, { ...emptyFilter(), text: "rome" }).map((p) => p.id).sort()).toEqual(["Codex/Locations/Rome", "s2", "s5"].sort());
  });
  it("lists facets most used first", () => {
    const f = facets(pins);
    expect(f.kinds[0][0]).toBe("scene");
    expect(f.characters.sort()).toEqual(["Ann", "Bob"]);
    expect(f.books).toEqual(["B1"]);
  });
});

describe("pins on several maps", () => {
  const recs: PinRecord[] = [
    rec({ id: "Codex/Locations/Harbor", kind: "location", label: "Harbor", own: { lat: 38.7, lng: -9.1 }, on: { reach: { x: 100, y: 200 } } }),
    rec({ id: "Codex/Locations/Keep", kind: "location", label: "Keep", on: { reach: { x: 400, y: 300 } } }),
    rec({ id: "s1", label: "Docking", places: ["Harbor"], start: 10, end: 10, chapter: "1" }),
    rec({ id: "s2", label: "Siege", places: ["Keep"], start: 20, end: 20, chapter: "1" }),
    rec({ id: "s3", label: "Own on reach", on: { reach: { x: 700, y: 50 } }, start: 30, end: 30, chapter: "2" }),
  ];
  it("shows only what is placed on the chosen map", () => {
    const world = buildPins(recs, "world").map((p) => p.id);
    expect(world).toContain("Codex/Locations/Harbor");
    expect(world).toContain("s1");
    expect(world).not.toContain("s2");
    const reach = buildPins(recs, "reach").map((p) => p.id);
    expect(reach).toEqual(expect.arrayContaining(["Codex/Locations/Harbor", "Codex/Locations/Keep", "s1", "s2", "s3"]));
  });
  it("uses the place's position on the same map, not another map's", () => {
    const onWorld = buildPins(recs, "world").find((p) => p.id === "s1")!;
    const onReach = buildPins(recs, "reach").find((p) => p.id === "s1")!;
    expect(onWorld).toMatchObject({ x: -9.1, y: 38.7 });
    expect(onReach).toMatchObject({ x: 100, y: 200 });
  });
  it("centres a chapter per map, with a plain mean on a drawn map", () => {
    const ch = buildPins(recs, "reach").find((p) => p.kind === "chapter" && p.label === "Chapter 1")!;
    expect(ch.x).toBeCloseTo((100 + 400) / 2, 9);
    expect(ch.y).toBeCloseTo((200 + 300) / 2, 9);
    expect(buildPins(recs, "elsewhere")).toEqual([]);
  });
});

describe("a chapter's position set by hand", () => {
  const recs: PinRecord[] = [
    rec({ id: "Codex/Locations/Harbor", kind: "location", label: "Harbor", on: { reach: { x: 100, y: 200 } } }),
    rec({ id: "s1", label: "Docking", places: ["Harbor"], start: 10, end: 11, chapter: "1", chapterTitle: "Chapter 1", book: "B" }),
    rec({ id: "s2", label: "No place", start: 20, end: 21, chapter: "1", chapterTitle: "Chapter 1", book: "B" }),
    rec({ id: "s3", label: "Elsewhere", start: 30, end: 31, chapter: "2", chapterTitle: "Chapter 2", book: "B" }),
  ];
  it("overrides the centre of its scenes", () => {
    const k = chapterKey("B", "1");
    const auto = buildPins(recs, "reach").find((p) => p.kind === "chapter")!;
    expect(auto).toMatchObject({ x: 100, y: 200, source: "chapter", chapterKey: k });
    const set = buildPins(recs, "reach", new Map([[k, { x: 5, y: 6 }]])).find((p) => p.kind === "chapter")!;
    expect(set).toMatchObject({ x: 5, y: 6, source: "chapterSet", chapterKey: k });
  });
  it("puts a chapter on the map even when none of its scenes are placed", () => {
    const k = chapterKey("B", "2");
    expect(buildPins(recs, "reach").some((p) => p.chapterKey === k)).toBe(false);
    const set = buildPins(recs, "reach", new Map([[k, { x: 7, y: 8 }]])).find((p) => p.chapterKey === k)!;
    expect(set).toMatchObject({ x: 7, y: 8, start: 30, end: 31, label: "Chapter 2" });
  });
  it("uses an override only on the map it was set for", () => {
    const k = chapterKey("B", "1");
    expect(buildPins(recs, "world", new Map()).some((p) => p.source === "chapterSet")).toBe(false);
    void k;
  });
});
