import { describe, it, expect } from "vitest";
import { followers, nextLifeStart, sequenceOf, applyEdit } from "../src/project/lifeSequence";

const L = (path: string, seq: number, when: string, whenEnd = "") => ({ path, character: "Ann", seq, when, whenEnd });

describe("life sequence", () => {
  it("starts the next life three days after the last ends", () => {
    expect(nextLifeStart("1342-05-01", "1342-05-10")).toBe("1342-05-13");
    expect(nextLifeStart("1342-05-01", "")).toBe("");
  });
  it("leaves out lives that float free", () => {
    const s = sequenceOf([L("a", 2, "1342"), L("b", 0, "1300"), L("c", 1, "1200")], "Ann");
    expect(s.map((l) => l.path)).toEqual(["c", "a"]);
  });
  const seq = [L("a", 1, "2000-01-01", "2000-01-10"), L("b", 2, "2000-01-13", "2000-01-20"), L("c", 3, "2000-01-23", "2000-02-01")];
  it("dragging an end moves only the next start", () => {
    expect(followers(seq, "a", "end")).toEqual([{ path: "b", kind: "start" }]);
  });
  it("shift moves every later life", () => {
    expect(followers(seq, "a", "end", true)).toEqual([{ path: "b", kind: "shift" }, { path: "c", kind: "shift" }]);
  });
  it("dragging a start pulls the end before it", () => {
    expect(followers(seq, "b", "start")).toEqual([{ path: "a", kind: "end" }]);
  });
  it("moving does both", () => {
    expect(followers(seq, "b", "move")).toEqual([{ path: "a", kind: "end" }, { path: "c", kind: "start" }]);
  });
  it("keeps the gap when applied", () => {
    const dT = 5 / 365.25;
    const next = applyEdit(seq[1], { path: "b", kind: "shift" }, dT);
    expect(next.when).toBe("2000-01-18");
  });
});
