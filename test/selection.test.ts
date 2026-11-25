import { describe, expect, it, vi } from "vitest";
import { SelectionStore, sameSelection } from "../src/scripture/selection";

describe("selection store", () => {
  it("starts empty and remembers the last place", () => {
    const s = new SelectionStore();
    expect(s.get()).toBeNull();
    s.set({ book: "John", chapter: 3, verse: 16 });
    expect(s.get()).toEqual({ book: "John", chapter: 3, verse: 16 });
  });

  it("tells listeners about a change but not about the same place again", () => {
    const s = new SelectionStore();
    const fn = vi.fn();
    s.subscribe(fn);
    expect(s.set({ book: "John", chapter: 3, verse: 16 })).toBe(true);
    expect(s.set({ book: "John", chapter: 3, verse: 16 })).toBe(false);
    expect(s.set({ book: "John", chapter: 3, verse: 17 })).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith({ book: "John", chapter: 3, verse: 17 });
  });

  it("treats a chapter alone (verse 0) as its own place", () => {
    const s = new SelectionStore();
    s.set({ book: "Ps", chapter: 23, verse: 1 });
    expect(s.set({ book: "Ps", chapter: 23, verse: 0 })).toBe(true);
  });

  it("stops notifying after unsubscribe", () => {
    const s = new SelectionStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    off();
    s.set({ book: "Gen", chapter: 1, verse: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not let a listener change the stored place by editing what it was given", () => {
    const s = new SelectionStore();
    const place = { book: "Rom", chapter: 8, verse: 1 };
    s.set(place);
    place.verse = 99;
    expect(s.get()!.verse).toBe(1);
  });

  it("compares places, and null is never equal", () => {
    expect(sameSelection({ book: "A", chapter: 1, verse: 1 }, { book: "A", chapter: 1, verse: 1 })).toBe(true);
    expect(sameSelection(null, null)).toBe(false);
  });
});

import { lastVerse, verseSpan } from "../src/scripture/selection";
describe("a range of verses", () => {
  it("keeps the last verse and tells a range from one verse", () => {
    const s = new SelectionStore();
    expect(s.set({ book: "John", chapter: 3, verse: 16 })).toBe(true);
    expect(s.set({ book: "John", chapter: 3, verse: 16, verseTo: 18 })).toBe(true);
    expect(s.get()).toEqual({ book: "John", chapter: 3, verse: 16, verseTo: 18 });
    expect(s.set({ book: "John", chapter: 3, verse: 16, verseTo: 18 })).toBe(false);
  });
  it("treats an end at or before the start as one verse", () => {
    const s = new SelectionStore();
    s.set({ book: "John", chapter: 3, verse: 16 });
    expect(s.set({ book: "John", chapter: 3, verse: 16, verseTo: 16 })).toBe(false);
    expect(sameSelection({ book: "a", chapter: 1, verse: 2, verseTo: 1 }, { book: "a", chapter: 1, verse: 2 })).toBe(true);
  });
  it("names the span", () => {
    expect(verseSpan({ book: "J", chapter: 1, verse: 4, verseTo: 6 })).toBe("4-6");
    expect(verseSpan({ book: "J", chapter: 1, verse: 4 })).toBe("4");
    expect(lastVerse({ book: "J", chapter: 1, verse: 4, verseTo: 6 })).toBe(6);
  });
});
