import { describe, expect, it } from "vitest";
import { statSync } from "node:fs";
import { dropLetter, resolveOpening } from "../src/writing/initials";
import { openingCss, withDropCap } from "../src/export/epub";
import { ILLUMINATED } from "../src/writing/initialsData";

describe("chapter opening", () => {
  it("only a plain letter takes a drop cap", () => {
    expect(dropLetter("in the beginning")).toEqual({ ch: "I", rest: "n the beginning" });
    expect(dropLetter("“Quoted”")).toBeNull();
    expect(dropLetter("12 men")).toBeNull();
  });

  it("is the illuminated artwork by default and falls back to that for bad values", () => {
    expect(resolveOpening({ style: "nonsense" as never, frame: "x" as never, lines: 9 as never })).toEqual({ style: "art", frame: "none", lines: 2 });
  });

  it("the illuminated alphabet has all 26 letters", () => {
    expect(Object.keys(ILLUMINATED)).toHaveLength(26);
    for (const ch of Object.keys(ILLUMINATED)) expect(statSync(`assets/initials/illuminated/${ch}.png`).size).toBeGreaterThan(1000);
  });

  it("puts the letter in the first paragraph of a chapter and nothing when off", () => {
    const body = '<h1>One</h1>\n<p class="first">In the beginning.</p>\n<p>Next.</p>';
    expect(withDropCap(body, { style: "off", frame: "none", lines: 3 }, (c) => c).html).toBe(body);
    const art = withDropCap(body, { style: "art", frame: "none", lines: 3 }, (c) => `${c}.png`);
    expect(art.used).toBe("I");
    expect(art.html).toContain('<p class="first dropcap"><img class="initial art lines3" src="../images/initials/I.png" alt="I"/>n the beginning.</p>');
    const font = withDropCap(body, { style: "cinzel", frame: "double", lines: 4 }, (c) => c);
    expect(font.html).toContain('<span class="initial cinzel frame-double lines4">I</span>n the beginning.');
    expect(font.used).toBeNull();
  });

  it("writes CSS only for the chosen style", () => {
    expect(openingCss({ style: "off", frame: "none", lines: 3 })).toBe("");
    expect(openingCss({ style: "art", frame: "none", lines: 3 })).toContain("img.initial.art");
    expect(openingCss({ style: "fell", frame: "block", lines: 3 })).toContain("frame-block");
  });
});

describe("epub with the illuminated opening", () => {
  it("is the default and keeps the rest of the word beside the picture", () => {
    const body = '<p class="first">Hello there.</p>';
    const out = withDropCap(body, undefined, (c) => `${c}.png`);
    expect(out.used).toBe("H");
    expect(out.html).toContain('alt="H"/>ello there.');
  });
});

import { openingAttrs } from "../src/writing/openingStyle";
describe("opening attributes", () => {
  it("switching the frame leaves nothing of the old one behind", () => {
    const block = openingAttrs({ style: "cinzel", frame: "block", lines: 3 }).class;
    const single = openingAttrs({ style: "cinzel", frame: "single", lines: 3 }).class;
    const none = openingAttrs({ style: "cinzel", frame: "none", lines: 3 }).class;
    expect(block).toContain("booker-frame-block");
    expect(single).not.toContain("booker-frame-block");
    expect(none).not.toContain("booker-frame-block");
    expect(openingAttrs({ style: "off" }).class).toBe("");
    expect(openingAttrs({ style: "art", frame: "block", lines: 2 }).class).not.toContain("booker-frame");
  });
});
