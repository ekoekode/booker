import { describe, it, expect } from "vitest";
import { chooseRenderer, parseRenderer, probeText, whyCompatible, type RendererSetting, type WebGLProbe } from "../src/project/mapRenderer";

describe("renderer choice", () => {
  const table: Array<[RendererSetting, WebGLProbe, string]> = [
    ["auto", "ok", "webgl"],
    ["auto", "software", "compatible"],
    ["auto", "none", "compatible"],
    ["webgl", "ok", "webgl"],
    ["webgl", "software", "webgl"],
    ["webgl", "none", "compatible"],
    ["compatible", "ok", "compatible"],
    ["compatible", "software", "compatible"],
    ["compatible", "none", "compatible"],
  ];
  it.each(table)("%s with %s gives %s", (s, p, want) => expect(chooseRenderer(s, p)).toBe(want));
  it("parses the setting", () => {
    expect(parseRenderer("webgl")).toBe("webgl");
    expect(parseRenderer("compatible")).toBe("compatible");
    expect(parseRenderer("x")).toBe("auto");
    expect(parseRenderer(undefined)).toBe("auto");
  });
  it("explains itself", () => {
    expect(probeText("ok")).toContain("available");
    expect(probeText("software")).toContain("software");
    expect(probeText("none")).toContain("not available");
    expect(whyCompatible("auto", "none")).toContain("not available");
    expect(whyCompatible("auto", "software")).toContain("software-only");
    expect(whyCompatible("compatible", "ok")).toContain("Maps settings");
    expect(whyCompatible("auto", "ok", true)).toContain("failed");
  });
});
