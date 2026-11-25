import { describe, expect, it } from "vitest";
import { History, placeFromState, samePlace } from "../src/reader/place";

describe("placeFromState", () => {
  it("reads the new place field", () => {
    expect(placeFromState({ place: { kind: "work", uid: "u1", entry: 7 } })).toEqual({ kind: "work", uid: "u1", entry: 7 });
    expect(placeFromState({ place: { kind: "commentary", path: "a.cmtx", book: "John", chapter: 3, verse: 16 } })).toEqual({ kind: "commentary", path: "a.cmtx", book: "John", chapter: 3, verse: 16 });
  });
  it("migrates the old two-tab state", () => {
    expect(placeFromState({ module: "B.bblx", book: "Rom", chapter: 8, verse: 28, mode: "bible" })).toEqual({ kind: "bible", module: "B.bblx", book: "Rom", chapter: 8, verse: 28 });
    expect(placeFromState({ mode: "library", uid: "u9", entry: 3, db: "X" })).toEqual({ kind: "work", uid: "u9", entry: 3 });
    expect(placeFromState({ mode: "library", db: "Church" })).toEqual({ kind: "works", db: "Church" });
    expect(placeFromState({ mode: "library" })).toEqual({ kind: "shelf" });
    expect(placeFromState({ mode: "library", cmt: { path: "c.cmtx", book: "Gen" } })).toEqual({ kind: "commentary", path: "c.cmtx", book: "Gen" });
  });
  it("never throws on missing or odd state", () => {
    expect(placeFromState(undefined).kind).toBe("bible");
    expect(placeFromState({ place: { kind: "nonsense" }, book: "Ps", chapter: 23 })).toMatchObject({ kind: "bible", book: "Ps", chapter: 23 });
    expect(placeFromState({ place: { kind: "work" } })).toEqual({ kind: "shelf" });
    expect(placeFromState({ chapter: -4, verse: "x" })).toMatchObject({ chapter: 1, verse: 0 });
  });
});

describe("History", () => {
  const b = (c: number) => ({ kind: "bible", module: "", book: "John", chapter: c, verse: 0 }) as const;
  it("goes back and forward and drops forward places on a new step", () => {
    const h = new History();
    h.push(b(1));
    h.push(b(2));
    h.push({ kind: "shelf" });
    expect(h.back()).toEqual(b(2));
    expect(h.back()).toEqual(b(1));
    expect(h.canBack).toBe(false);
    expect(h.forward()).toEqual(b(2));
    h.push(b(5));
    expect(h.canForward).toBe(false);
    expect(h.back()).toEqual(b(2));
  });
  it("ignores a repeat and can replace the current place", () => {
    const h = new History();
    h.push(b(1));
    h.push(b(1));
    expect(h.canBack).toBe(false);
    h.replace(b(1.0 as number));
    h.replace({ ...b(1), verse: 16 });
    expect(h.current).toMatchObject({ verse: 16 });
    expect(samePlace(b(1), b(1))).toBe(true);
  });
  it("keeps at most its cap", () => {
    const h = new History(3);
    for (let i = 1; i <= 6; i++) h.push(b(i));
    h.back();
    h.back();
    expect(h.canBack).toBe(false);
    expect(h.current).toEqual(b(4));
  });
});

describe("a saved range of verses", () => {
  it("keeps the end of a range and drops one that is not after the start", () => {
    expect(placeFromState({ place: { kind: "bible", module: "", book: "John", chapter: 3, verse: 16, verseTo: 18 } })).toMatchObject({ verse: 16, verseTo: 18 });
    expect(placeFromState({ place: { kind: "bible", module: "", book: "John", chapter: 3, verse: 16, verseTo: 10 } })).not.toHaveProperty("verseTo");
    expect(placeFromState({ place: { kind: "commentary", path: "c.cmtx", book: "John", chapter: 3, verse: 2, verseTo: 4 } })).toMatchObject({ verseTo: 4 });
  });
});
