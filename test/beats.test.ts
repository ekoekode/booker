import { describe, expect, it } from "vitest";
import { BEAT_SHEETS, beatCoverage, emptyBeats, sheetByName } from "../src/project/beats";
import { checkLinks, pairs, withTitle, type LinkScene } from "../src/project/setupPayoff";

describe("beat sheets", () => {
  it("every sheet has beats inside its acts and in order", () => {
    for (const s of BEAT_SHEETS) {
      expect(s.beats.length).toBeGreaterThan(5);
      const acts = s.beats.map((x) => x.act);
      expect([...acts].sort((a, b) => a - b)).toEqual(acts);
      for (const a of acts) expect(s.actLabels[a]).toBeTruthy();
    }
  });
  it("finds a sheet by name or id", () => {
    expect(sheetByName("Save the Cat")?.id).toBe("save-the-cat");
    expect(sheetByName("three-act")?.name).toBe("Three-act structure");
    expect(sheetByName("nope")).toBeUndefined();
  });
  it("counts a scene by its beat property or by its title for scenes made from the sheet", () => {
    const sheet = sheetByName("three-act")!;
    const rows = beatCoverage(sheet, [
      { path: "a", title: "Opening", beatsheet: sheet.name },
      { path: "b", title: "Whatever", beat: "midpoint" },
      { path: "c", title: "Climax" },
      { path: "d", title: "Other", beat: "Climax", beatsheet: "Save the Cat" },
    ]);
    const has = (label: string) => rows.find((r) => r.beat.label === label)!.scenes.map((s) => s.path);
    expect(has("Opening")).toEqual(["a"]);
    expect(has("Midpoint")).toEqual(["b"]);
    expect(has("Climax")).toEqual([]);
    expect(emptyBeats(rows).map((x) => x.label)).toContain("Climax");
  });
});

const sc = (title: string, order: number, payoff: string[] = [], setup: string[] = []): LinkScene => ({ path: title, title, order, payoff, setup });

describe("setup and payoff", () => {
  it("counts a link recorded on either end once", () => {
    expect(pairs([sc("A", 0, ["B"]), sc("B", 1, [], ["A"]), sc("C", 2, [], ["A"])])).toEqual([
      { setup: "A", payoff: "B" },
      { setup: "A", payoff: "C" },
    ]);
  });
  it("reports a clean pair as fine", () => {
    expect(checkLinks([sc("A", 0, ["B"]), sc("B", 1, [], ["A"])])).toEqual([]);
  });
  it("finds a missing scene, a one-way link, a backwards payoff and a self link", () => {
    expect(checkLinks([sc("A", 0, ["Ghost"])]).map((i) => i.kind)).toEqual(["missing"]);
    expect(checkLinks([sc("A", 0, ["B"]), sc("B", 1)]).map((i) => i.kind)).toEqual(["one-way"]);
    expect(checkLinks([sc("A", 5, ["B"]), sc("B", 1, [], ["A"])]).map((i) => i.kind)).toEqual(["backwards"]);
    expect(checkLinks([sc("A", 0, ["A"], ["A"])]).map((i) => i.kind)).toEqual(["self"]);
  });
  it("one-way issue points at the scene that lacks the link", () => {
    expect(checkLinks([sc("A", 0, ["B"]), sc("B", 1)])[0].path).toBe("B");
  });
  it("withTitle adds once and removes", () => {
    expect(withTitle(["x"], "y", true)).toEqual(["x", "y"]);
    expect(withTitle(["x", "y"], "y", true)).toEqual(["x", "y"]);
    expect(withTitle(["x", "y"], "y", false)).toEqual(["x"]);
  });
});
