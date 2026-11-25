import { describe, expect, it } from "vitest";
import { nextLabel, planFootnote } from "../src/notes/footnote";

const apply = (text: string, at: number) => {
  const e = planFootnote(text, at);
  const out = text.slice(0, e.markAt) + e.mark + text.slice(e.markAt, e.appendAt) + e.append;
  return { out, e };
};

describe("insert footnote", () => {
  it("numbers from one and adds the note's line at the end", () => {
    const { out, e } = apply("Hello world.\n", 5);
    expect(out).toBe("Hello[^1] world.\n\n[^1]: ");
    expect(out.slice(e.cursor)).toBe("");
  });
  it("continues after the highest label and groups notes together", () => {
    expect(nextLabel("a[^1] b[^7] [^x]")).toBe("8");
    const { out } = apply("Text[^1].\n\n[^1]: First.\n", 0);
    expect(out).toBe("[^2]Text[^1].\n\n[^1]: First.\n[^2]: ");
  });
});
