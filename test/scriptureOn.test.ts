import { describe, expect, it } from "vitest";
import { scriptureOn } from "../src/project/vaultOps";

const proj = (profile: string, scripture?: boolean) => ({ profile, scripture }) as any;

describe("scriptureOn", () => {
  it("follows the kind of book", () => {
    for (const id of ["sermon", "bible-study", "nonfiction-christian", "nonfiction-educational"]) expect(scriptureOn(proj(id))).toBe(true);
    for (const id of ["fiction", "self-help", "reference"]) expect(scriptureOn(proj(id))).toBe(false);
  });
  it("lets the book's own setting win", () => {
    expect(scriptureOn(proj("fiction", true))).toBe(true);
    expect(scriptureOn(proj("sermon", false))).toBe(false);
  });
});
