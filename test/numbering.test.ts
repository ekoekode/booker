import { describe, expect, it } from "vitest";
import { planRenumber, sceneName, sceneTitle } from "../src/project/numbering";

describe("scene numbering", () => {
  it("finds the name after the number", () => {
    expect(sceneName("Scene 3")).toBe("");
    expect(sceneName("Section 2")).toBe("");
    expect(sceneName("Scene 3 - The Title")).toBe("The Title");
    expect(sceneName("Cold Lamp")).toBe("Cold Lamp");
  });
  it("composes titles", () => {
    expect(sceneTitle(4, "")).toBe("Scene 4");
    expect(sceneTitle(4, "Flight")).toBe("Scene 4 - Flight");
  });
  it("numbers across chapters and follows a reorder", () => {
    const list = [
      { path: "a", title: "Scene 1" },
      { path: "b", title: "Scene 2 - Harbour" },
      { path: "c", title: "Section 1" },
      { path: "d", title: "Flight" },
    ];
    expect(planRenumber(list)).toEqual([
      { path: "c", title: "Scene 3" },
      { path: "d", title: "Scene 4 - Flight" },
    ]);
    expect(planRenumber([list[0], list[2], list[1]])).toEqual([
      { path: "c", title: "Scene 2" },
      { path: "b", title: "Scene 3 - Harbour" },
    ]);
  });
});
