import { describe, expect, it } from "vitest";
import { cursorAfter } from "../src/writing/wrap";

describe("cursorAfter", () => {
  it("puts the cursor after a heading mark made on an empty line", () => {
    expect(cursorAfter({ from: 10, to: 10 }, "# ", 10)).toBe(12);
  });
  it("keeps the cursor at the same distance from the end of a line", () => {
    expect(cursorAfter({ from: 0, to: 11 }, "# Hello world", 11)).toBe(13);
    expect(cursorAfter({ from: 0, to: 11 }, "# Hello world", 5)).toBe(7);
  });
  it("never goes before the line", () => {
    expect(cursorAfter({ from: 4, to: 8 }, "", 4)).toBe(4);
  });
});
