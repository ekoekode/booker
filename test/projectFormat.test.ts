import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT } from "../src/writing/format";
import { defaultBundle, effectiveFormat, readProjectFormat, toFormatFm } from "../src/writing/projectFormat";

const def = defaultBundle({ ...DEFAULT_FORMAT }, { style: "art", frame: "none", lines: 2 });

describe("project writing format", () => {
  it("a project with no format of its own uses the plugin default, and follows it", () => {
    expect(readProjectFormat({})).toBeNull();
    expect(effectiveFormat(def, null)).toBe(def);
    const changed = defaultBundle({ ...DEFAULT_FORMAT, indent: 2.5 }, def.opening);
    expect(effectiveFormat(changed, readProjectFormat({}))).toBe(changed);
  });

  it("lays a project's own choices over the default", () => {
    const own = readProjectFormat({ writingFormat: { autoIndent: false, indent: 0.5, openingStyle: "cinzel", openingFrame: "double", openingLines: 4 } });
    const f = effectiveFormat(def, own);
    expect(f.writing.autoIndent).toBe(false);
    expect(f.writing.indent).toBe(0.5);
    expect(f.writing.bar).toBe(DEFAULT_FORMAT.bar);
    expect(f.opening).toEqual({ style: "cinzel", frame: "double", lines: 4 });
  });

  it("ignores odd values and round-trips a whole bundle", () => {
    const f = effectiveFormat(def, readProjectFormat({ writingFormat: { indent: "x", bar: 3, openingStyle: "nonsense" } }));
    expect(f.writing.indent).toBe(DEFAULT_FORMAT.indent);
    expect(f.opening.style).toBe("art");
    const back = effectiveFormat(defaultBundle({ ...DEFAULT_FORMAT, indent: 9 }, def.opening), toFormatFm(def));
    expect(back).toEqual(def);
  });
});
