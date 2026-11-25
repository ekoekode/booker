import { describe, expect, it } from "vitest";
import { parseMoby } from "../src/resources/moby";
import { EnglishIndex } from "../src/dictionary/lookup";

const sample = "abandon,desert,forsake,leave,abandon,desert\r\nbig,large,huge, huge ,Big\r\nnocomma\r\n,orphan,list\r\nzeal,ardor\r\n";

describe("parseMoby", () => {
  const rows = parseMoby(sample);
  it("makes one row per headword, sorted, with the headword and repeats left out", () => {
    expect(rows).toEqual([
      { word: "abandon", text: "desert, forsake, leave" },
      { word: "big", text: "large, huge" },
      { word: "zeal", text: "ardor" },
    ]);
  });
  it("skips lines with no synonyms or no headword", () => {
    expect(rows.find((r) => r.word === "nocomma")).toBeUndefined();
    expect(rows).toHaveLength(3);
  });
});

describe("thesaurus in the English index", () => {
  const dict = [{ word: "big", text: "adj. above average in size\nSynonyms: large, great" }];
  const thes = parseMoby("big,large,huge,vast\nzeal,ardor,passion\nbigger,larger");
  it("puts dictionary synonyms first, then the thesaurus's, without repeats", () => {
    const i = new EnglishIndex(dict);
    i.setThesaurus(thes);
    expect(i.hasThesaurus).toBe(true);
    expect(i.synonyms("big")).toEqual(["large", "great", "huge", "vast"]);
  });
  it("answers from the thesaurus alone for a word the dictionary lacks, and for inflected forms", () => {
    const i = new EnglishIndex(dict);
    i.setThesaurus(thes);
    expect(i.synonyms("zeal")).toEqual(["ardor", "passion"]);
    expect(i.synonyms("zeals")).toEqual(["ardor", "passion"]);
    expect(i.synonyms("unknownword")).toEqual([]);
  });
  it("ranks thesaurus synonyms that share the most neighbours with the word first", () => {
    const i = new EnglishIndex([]);
    i.setThesaurus(parseMoby("zeal,aaa,ardor,passion,xyz\nardor,zeal\npassion,zeal"));
    expect(i.synonyms("zeal")).toEqual(["ardor", "passion", "aaa", "xyz"]);
    expect(i.more("zeal", ["passion"])).toEqual(["ardor", "aaa", "xyz"]);
    expect(i.more("nothing")).toEqual([]);
  });
  it("behaves as before without a thesaurus", () => {
    const i = new EnglishIndex(dict);
    expect(i.hasThesaurus).toBe(false);
    expect(i.synonyms("big")).toEqual(["large", "great"]);
  });
});
