import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE } from "../src/scripture/format";
import { bookScripture, sameStyle, styleNameOf, withBook } from "../src/scripture/savedStyles";

const sermon = { ...DEFAULT_STYLE, layout: "inline" as const, numbers: "none" as const };

describe("saved verse styles", () => {
  it("finds the name a style was saved under", () => {
    expect(styleNameOf({ Sermon: sermon }, { ...sermon })).toBe("Sermon");
    expect(styleNameOf({ Sermon: sermon }, DEFAULT_STYLE)).toBeUndefined();
    expect(sameStyle({ layout: "inline" }, { layout: "inline" })).toBe(true);
  });
  it("reads a book's choice from its note", () => {
    expect(bookScripture({ bible: " Booker/Bibles/BSB.bbl.mybible ", verseStyle: "Sermon" })).toEqual({ bible: "Booker/Bibles/BSB.bbl.mybible", verseStyle: "Sermon" });
    expect(bookScripture({ bible: 3 })).toEqual({ bible: undefined, verseStyle: undefined });
  });
  it("lays the book's Bible and style over the global settings", () => {
    const g = { defaultModule: "a", style: DEFAULT_STYLE, savedStyles: { Sermon: sermon } };
    const d = withBook(g, { bible: "b", verseStyle: "Sermon" });
    expect(d.defaultModule).toBe("b");
    expect(d.style.layout).toBe("inline");
    expect(withBook(g, { verseStyle: "Gone" })).toEqual(g);
    expect(withBook(g, {}).defaultModule).toBe("a");
  });
});
