import { describe, expect, it } from "vitest";
import { decodeQuote, encodeQuote, footnoteFor, joinQuotations, quoteBlock, quotePlain } from "../src/reader/quote";

describe("quotation", () => {
  it("builds a footnote from source and place", () => {
    expect(footnoteFor("BLB", "John 3:16-18")).toBe("BLB, John 3:16-18.");
    expect(footnoteFor("", "John 3:16.")).toBe("John 3:16.");
    expect(footnoteFor("", "")).toBe("");
  });
  it("round-trips through the clipboard type and rejects junk", () => {
    const q = { text: "In the beginning", footnote: "BLB, John 1:1." };
    expect(decodeQuote(encodeQuote(q))).toEqual(q);
    expect(decodeQuote("nope")).toBeNull();
    expect(decodeQuote(undefined)).toBeNull();
    expect(decodeQuote(JSON.stringify({ text: " ", footnote: "x" }))).toBeNull();
  });
  it("gives other programs the words and where they are from", () => {
    expect(quotePlain({ text: "a b", footnote: "BLB, John 1:1." })).toBe("a b\n\n— BLB, John 1:1.");
    expect(quotePlain({ text: "a b", footnote: "" })).toBe("a b");
  });
  it("joins quotations, keeping distinct footnotes once", () => {
    const j = joinQuotations([{ text: "one", footnote: "X, on John 1." }, { text: "two", footnote: "X, on John 1." }, { text: "", footnote: "Y." }]);
    expect(j).toEqual({ text: "one\n\ntwo", footnote: "X, on John 1." });
    expect(joinQuotations([])).toBeNull();
  });
  it("makes a block quote with a blank quoted line between paragraphs", () => {
    expect(quoteBlock("a\n\nb")).toBe("> a\n>\n> b");
  });
});
