import { describe, expect, it } from "vitest";
import { buildMatcher, applyInsertions, findInsertions } from "../src/autolinkCore";
import { iesForm, pluralEndings, pluralSuffixLength } from "../src/nameVariants";

const link = (text: string, names: string[]) => {
  const m = buildMatcher(names.map((n) => ({ name: n, target: n })));
  return applyInsertions(text, findInsertions(text, m, { mode: "every" }));
};

describe("nameVariants", () => {
  it("knows plural endings", () => {
    expect(pluralEndings("Christian")).toEqual(["s"]);
    expect(pluralEndings("Church")).toEqual(["es", "s"]);
    expect(pluralEndings("Bo")).toEqual([]);
    expect(pluralSuffixLength("Christian", "s are here")).toBe(1);
    expect(pluralSuffixLength("Christian", "ity")).toBe(0);
    expect(iesForm("Berry")).toBe("Berries");
    expect(iesForm("Gray")).toBeNull();
  });
  it("links a plural to the same note, keeping what was typed", () => {
    expect(link("The Christians met.", ["Christian"])).toBe("The [[Christian|Christians]] met.");
    expect(link("Two Churches stood.", ["Church"])).toBe("Two [[Church|Churches]] stood.");
    expect(link("The Berries fell.", ["Berry"])).toBe("The [[Berry|Berries]] fell.");
  });
  it("links possessives, singular and plural", () => {
    expect(link("Bobby's hat", ["Bobby"])).toBe("[[Bobby]]'s hat");
    expect(link("the Christians' hall", ["Christian"])).toBe("the [[Christian|Christians]]' hall");
  });
  it("does not link a longer word", () => {
    expect(link("Christianity grew.", ["Christian"])).toBe("Christianity grew.");
  });
});
