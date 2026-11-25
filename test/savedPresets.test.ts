import { describe, expect, it } from "vitest";
import { applyPreset, deletePreset, presetName, presetNames, savePreset } from "../src/export/savedPresets";

const base: any = { docx: true, epub: true, pdf: true, preset: "manuscript", minStatus: "idea" };

describe("saved export presets", () => {
  it("saves, replaces ignoring case, lists sorted", () => {
    let p = savePreset(undefined, "Agent", base);
    p = savePreset(p, "Print", { ...base, preset: "trade" });
    p = savePreset(p, "agent", { ...base, pdf: false });
    expect(presetNames(p)).toEqual(["agent", "Print"]);
    expect(p.agent.pdf).toBe(false);
  });
  it("deletes", () => {
    expect(presetNames(deletePreset(savePreset(undefined, "A", base), "A"))).toEqual([]);
  });
  it("applies over current options", () => {
    expect(applyPreset(base, { preset: "trade" }).docx).toBe(true);
    expect(applyPreset(base, { preset: "trade" }).preset).toBe("trade");
    expect(applyPreset(base, undefined)).toEqual(base);
  });
  it("tidies names", () => {
    expect(presetName("  My   agent  ")).toBe("My agent");
  });
});
