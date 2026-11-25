import { describe, expect, it } from "vitest";
import { sortGlossary } from "../src/export/glossary";

describe("glossary", () => {
  it("sorts entries and bolds the terms", () => {
    const out = sortGlossary("Grace: unearned favour\n- **Atonement** — making amends\n  by sacrifice\nFaith - trust");
    expect(out).toBe("**Atonement.** making amends by sacrifice\n\n**Faith.** trust\n\n**Grace.** unearned favour");
  });
  it("leaves ordinary prose alone", () => {
    expect(sortGlossary("A glossary of words used.\nGrace: unearned favour")).toBeNull();
    expect(sortGlossary("Just one: entry")).toBeNull();
  });
});
