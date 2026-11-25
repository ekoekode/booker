import { describe, expect, it } from "vitest";
import { RESOURCES } from "../src/resources/catalog";

describe("downloadable Bibles", () => {
  it("WEB, OEB and BSB are eBible.org USFX downloads with a pattern that finds them once added", () => {
    for (const id of ["web", "oeb", "bsb"]) {
      const r = RESOURCES.find((x) => x.id === id)!;
      expect(r.kind).toBe("bible");
      expect(r.files[0].url).toMatch(/^https:\/\/ebible\.org\/Scriptures\/.+_usfx\.zip$/);
      expect(new RegExp(r.detect!, "i").test(`${r.title}`)).toBe(true);
    }
  });
  it("every resource has a unique id", () => {
    const ids = RESOURCES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
