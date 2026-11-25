import { describe, expect, it } from "vitest";
import { vocabFor, richFor, HIGH_WORDS } from "../src/dictionary/vocab";
import { candidates, EnglishIndex, parseSenses, wordAt } from "../src/dictionary/lookup";

describe("vocab", () => {
  it("offers richer words and keeps a capital letter", () => {
    expect(vocabFor("angry")[0]).toBe("furious");
    expect(vocabFor("Angry")[0]).toBe("Furious");
    expect(vocabFor("table")).toEqual([]);
  });
  it("adds dictionary synonyms only when they are on the richer list", () => {
    expect(vocabFor("sad", ["glum", "forlorn", "blue"], 8)).not.toContain("glum");
    expect(HIGH_WORDS.has("forlorn")).toBe(true);
  });
});

describe("richFor", () => {
  it("gives new words based on a richer word already written", () => {
    const r = richFor("furious", ["angry", "enraged", "wild"]);
    expect(r.slice(0, 3)).toEqual(["irate", "incensed", "indignant"]);
    expect(r).toContain("enraged");
    expect(r).not.toContain("furious");
  });
  it("keeps a capital letter and ignores words not on the richer list", () => {
    expect(richFor("Furious")[0]).toBe("Irate");
    expect(richFor("table", ["desk"])).toEqual([]);
  });
});

describe("lookup", () => {
  const idx = new EnglishIndex([
    { word: "run", text: "v. move fast\nSynonyms: sprint, dash\n\nn. a trip\nSynonyms: jaunt" },
    { word: "cat", text: "n. a feline" },
  ]);
  it("parses senses and synonyms", () => {
    expect(parseSenses("v. move fast\nSynonyms: sprint, dash\n\nn. a trip")).toEqual([
      { pos: "v.", gloss: "move fast", synonyms: ["sprint", "dash"] },
      { pos: "n.", gloss: "a trip", synonyms: [] },
    ]);
  });
  it("finds base forms of typed words", () => {
    expect(candidates("running")).toContain("run");
    expect(idx.find("running")?.word).toBe("run");
    expect(idx.find("cats")?.word).toBe("cat");
    expect(idx.find("zzz")).toBeNull();
  });
  it("lists synonyms once each", () => {
    expect(idx.synonyms("run")).toEqual(["sprint", "dash", "jaunt"]);
  });
  it("finds the word at an offset", () => {
    expect(wordAt("the angry man", 6)).toEqual({ from: 4, to: 9, word: "angry" });
    expect(wordAt("the angry man", 3)?.word).toBe("the");
    expect(wordAt("  ", 1)).toBeNull();
  });
});
