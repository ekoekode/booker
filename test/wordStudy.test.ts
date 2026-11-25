import { describe, expect, it } from "vitest";
import { placeFromState } from "../src/reader/place";
import { parseStrongsJs, parseStepLexicon } from "../src/resources/dictionaries";
import { BereanParser, type IBook } from "../src/scripture/interlinear";

describe("word study data", () => {
  it("reads Berean rows into verses, in order of the original", () => {
    const head = ["Heb Sort", "Greek Sort", "BSB Sort", "Verse", "Language", "Hebrew/Greek", "Translit", "Parsing", "Str Heb", "Str Grk", "VerseId", "BSB version"].join("\t");
    const row = (sort: number, t: string, g: string, n: string) => ["" + sort, "", "1", "x", "Hebrew", t, "tr", "N", n, "", "Genesis 1:1", g].join("\t");
    const books: Record<string, IBook> = {};
    const p = new BereanParser((o, d) => (books[o] = d));
    for (const l of [head, row(2, "אֱלֹהִים", "God", "430"), row(1, "בְּרֵאשִׁית", "In the beginning", "7225")]) p.push(l);
    p.end();
    const words = books["Gen"]["1"]["1"];
    expect(words.map((w) => w.s)).toEqual(["H7225", "H430"]);
  });

  it("makes Strong's rows", () => {
    const rows = parseStrongsJs('var x = {"H430":{"lemma":"אֱלֹהִים","xlit":"ʼĕlôhîym","strongs_def":"gods","kjv_def":"God"}};', "H");
    expect(rows[0].word).toBe("H430");
    expect(rows[0].text).toContain("gods");
    expect(parseStepLexicon("junk\n", "G")).toEqual([]);
  });

  it("round-trips the word place", () => {
    const p = { kind: "word", strongs: "H430", text: "אֱלֹהִים", translit: "Elohim", gloss: "God", parse: "N" } as const;
    expect(placeFromState({ place: p })).toEqual(p);
    expect(placeFromState({ place: { kind: "word" } })).toEqual({ kind: "shelf" });
  });
});

import { moveCard, orderCards, relatedStrongs, splitStrongs } from "../src/scripture/wordstudy";

describe("word page helpers", () => {
  it("finds Strong's numbers in text", () => {
    expect(splitStrongs("see H0430a and G3056.")).toEqual([{ t: "see " }, { t: "H0430a", s: "H430" }, { t: " and " }, { t: "G3056", s: "G3056" }, { t: "." }]);
  });
  it("lists related numbers by how often, not itself", () => {
    expect(relatedStrongs(["H1 H2 H2", "H2 H430"], "H430")).toEqual(["H2", "H1"]);
  });
  it("orders and moves cards", () => {
    expect(orderCards(["a", "b", "c"], ["c", "x"])).toEqual(["c", "a", "b"]);
    expect(moveCard(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveCard(["a", "b", "c"], "a", "down")).toEqual(["b", "a", "c"]);
    expect(moveCard(["a", "b", "c"], "c", "top")).toEqual(["c", "a", "b"]);
  });
});
