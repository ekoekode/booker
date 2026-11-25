// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { offsetIn, partsOf, unwrapMarks, wrapRanges } from "../src/views/reader/selectionBar";

const verse = (n: number, words: string) => {
  const p = document.createElement("p");
  p.dataset.v = String(n);
  p.innerHTML = `<sup>${n}</sup><span class="booker-bible-vtext">${words}</span>`;
  return p;
};

describe("offsets in a verse", () => {
  it("counts the characters before a point, across elements", () => {
    const el = document.createElement("span");
    el.innerHTML = "For <i>God</i> so loved";
    const so = el.lastChild as Text;
    expect(offsetIn(el, so, 3)).toBe(4 + 3 + 3);
    expect(offsetIn(el, el, 2)).toBe(7);
  });
});

describe("the verses a selection covers", () => {
  const rows = [verse(1, "In the beginning"), verse(2, "The earth was formless"), verse(3, "Let there be light")];
  const host = document.createElement("div");
  rows.forEach((r) => host.appendChild(r));
  document.body.appendChild(host);
  const text = (i: number) => rows[i].querySelector(".booker-bible-vtext")!.firstChild as Text;

  it("gives the part of one verse", () => {
    const r = document.createRange();
    r.setStart(text(0), 3);
    r.setEnd(text(0), 6);
    expect(partsOf(r, rows)).toEqual([{ verse: 1, start: 3, end: 6, text: "the" }]);
  });
  it("gives the end of the first verse, all of the middle and the start of the last", () => {
    const r = document.createRange();
    r.setStart(text(0), 7);
    r.setEnd(text(2), 7);
    expect(partsOf(r, rows).map((p) => [p.verse, p.text])).toEqual([[1, "beginning"], [2, "The earth was formless"], [3, "Let the"]]);
  });
  it("ignores the verse number", () => {
    const r = document.createRange();
    r.setStart(rows[1].querySelector("sup")!.firstChild!, 0);
    r.setEnd(text(1), 3);
    expect(partsOf(r, rows).map((p) => p.text)).toEqual(["The"]);
  });
});

describe("colouring stretches", () => {
  it("wraps stretches across elements and takes them out again", () => {
    const el = document.createElement("div");
    el.innerHTML = "grace and <i>grace</i> again";
    const marks = wrapRanges(el, [{ start: 0, end: 5, cls: "a", data: { hl: "x" } }, { start: 10, end: 15, cls: "a" }]);
    expect(marks.map((m) => m.textContent)).toEqual(["grace", "grace"]);
    expect(marks[0].dataset.hl).toBe("x");
    expect(el.textContent).toBe("grace and grace again");
    unwrapMarks(el, "mark.a");
    expect(el.querySelectorAll("mark").length).toBe(0);
    expect(el.textContent).toBe("grace and grace again");
  });
  it("splits a stretch that crosses an element edge", () => {
    const el = document.createElement("div");
    el.innerHTML = "so <b>lov</b>ed";
    const marks = wrapRanges(el, [{ start: 3, end: 7, cls: "m" }]);
    expect(marks.map((m) => m.textContent)).toEqual(["lov", "e"]);
  });
});
