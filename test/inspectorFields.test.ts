import { describe, expect, it } from "vitest";
import { addToList, cleanLinkName, itemName, linkValue, numberValue, removeFromList, textValue, toLink, validateAlias } from "../src/views/inspectorFields";

describe("inspector field helpers", () => {
  it("cleans and builds links", () => {
    expect(cleanLinkName("[[Mara|M]]")).toBe("Mara");
    expect(cleanLinkName("  Mara  ")).toBe("Mara");
    expect(toLink("Mara")).toBe("[[Mara]]");
    expect(linkValue("")).toBeNull();
    expect(linkValue("[[ ]]")).toBeNull();
    expect(linkValue("Mara")).toBe("[[Mara]]");
  });
  it("never produces empty strings", () => {
    expect(textValue("  ")).toBeNull();
    expect(textValue(" a ")).toBe("a");
    expect(numberValue("")).toBeNull();
    expect(numberValue("abc")).toBeNull();
    expect(numberValue("1,500")).toBe(1500);
    expect(numberValue("-3")).toBeNull();
  });
  it("adds and removes list items without duplicates", () => {
    expect(addToList(null, "Mara", true)).toEqual(["[[Mara]]"]);
    expect(addToList(["[[Mara|M]]"], "mara", true)).toEqual(["[[Mara|M]]"]);
    expect(addToList("[[A]]", "B", true)).toEqual(["[[A]]", "[[B]]"]);
    expect(removeFromList(["[[A]]", "[[B|b]]"], "B", true)).toEqual(["[[A]]"]);
    expect(addToList(["Ann"], "ann", false)).toEqual(["Ann"]);
    expect(removeFromList(["Ann", "Bo"], "Bo", false)).toEqual(["Ann"]);
    expect(itemName("[[Mara|M]]")).toBe("Mara");
  });
  it("validates aliases", () => {
    expect(validateAlias("M")).toBeTruthy();
    expect(validateAlias("a|b")).toBeTruthy();
    expect(validateAlias("a[b")).toBeTruthy();
    expect(validateAlias("a#b")).toBeTruthy();
    expect(validateAlias("a^b")).toBeTruthy();
    expect(validateAlias("a\nb")).toBeTruthy();
    expect(validateAlias("Mar")).toBeNull();
  });
});
