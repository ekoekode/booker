import { describe, expect, it } from "vitest";
import { strayPlace } from "../src/project/vaultOps";

describe("strayPlace", () => {
  it("reads the act from the folder and the order from the file name", () => {
    expect(strayPlace("B/Scenes", "B/Scenes/Act 3/03-07 The Storm.md")).toEqual({ act: 3, sequence: 7, title: "The Storm" });
  });
  it("falls back to act 1 and the file name", () => {
    expect(strayPlace("B/Scenes", "B/Scenes/Loose note.md")).toEqual({ act: 1, sequence: undefined, title: "Loose note" });
  });
  it("uses the folder's number for a plain file in a part folder", () => {
    expect(strayPlace("B/Scenes", "B/Scenes/Part 2/Idea.md").act).toBe(2);
  });
});
