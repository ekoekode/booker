import { describe, expect, it } from "vitest";
import { dialogueSplit, findEchoes, proseOf, readability, sentencesOf, syllables, topWords, wordsOf } from "../src/project/prose";

describe("prose", () => {
  it("strips properties, links and marks", () => {
    expect(proseOf("---\ntitle: x\n---\n# Head\nShe saw [[Mara|Mara Vance]] *run*.")).toBe("She saw Mara Vance run.");
  });
  it("counts syllables roughly", () => {
    expect([syllables("cat"), syllables("table"), syllables("beautiful"), syllables("jumped")]).toEqual([1, 2, 3, 1]);
  });
  it("splits sentences", () => {
    expect(sentencesOf('He ran. "Stop!" she said. Why?')).toHaveLength(3);
  });
  it("reads a simple passage as easy", () => {
    const r = readability("The cat sat on the mat. The dog ran to the park. It was a good day.");
    expect(r.words).toBe(17);
    expect(r.sentences).toBe(3);
    expect(r.ease).toBeGreaterThan(90);
    expect(r.grade).toBeLessThan(3);
  });
  it("is zero for an empty text", () => {
    expect(readability("").ease).toBe(0);
  });
  it("separates dialogue from narrative", () => {
    const d = dialogueSplit('He turned. “Come here now,” she said, and “quickly.”');
    expect(d.dialogue).toBe(4);
    expect(d.narrative).toBe(5);
    expect(dialogueSplit('"Hi," he said.')).toEqual({ dialogue: 1, narrative: 2 });
  });
  it("lists the words leaned on, skipping everyday words", () => {
    const t = topWords(["The lamp, the lamp, the harbour. A lamp and a harbour."]);
    expect(t[0]).toEqual({ word: "lamp", count: 3 });
    expect(t[1]).toEqual({ word: "harbour", count: 2 });
    expect(t.find((x) => x.word === "the")).toBeUndefined();
  });
  it("finds words that come back too soon", () => {
    const e = findEchoes("The lantern swung in the wind and the lantern flickered, then the lantern died.", 10);
    expect(e[0].phrase).toBe("lantern");
    expect(e[0].count).toBe(2);
    expect(findEchoes("The lantern swung. " + Array.from({ length: 100 }, (_, i) => "filler" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26))).join(" ") + " lantern died.", 10)).toEqual([]);
  });
  it("tokenises words with apostrophes", () => {
    expect(wordsOf("Don’t stop, it's fine")).toEqual(["Don’t", "stop", "it's", "fine"]);
  });
});

import { analyse, combine, topFromFreq } from "../src/project/prose";
describe("scene analysis", () => {
  it("adds up across scenes", () => {
    const a = analyse('---\ntitle: a\n---\nThe lamp burned. "Come here," she said.');
    const b = analyse("The lamp went out. The harbour was dark.");
    const c = combine([a, b]);
    expect(c.words).toBe(a.words + b.words);
    expect(c.dialoguePct).toBeGreaterThan(0);
    expect(topFromFreq([a, b])[0]).toEqual({ word: "lamp", count: 2 });
  });
});
