import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { statSync } from "node:fs";

// real font and picture bytes, so the PDF and Word code that uses them is exercised
vi.mock("../src/export/fonts", () => {
  const f = (n: string) => new Uint8Array(readFileSync(`assets/fonts/Literata-${n}.ttf`));
  const data = { regular: f("Regular"), italic: f("Italic"), bold: f("Bold"), boldItalic: f("BoldItalic") };
  return { FONTS: data, FONT_FILES: [{ name: "Literata-Regular.ttf", data: data.regular }] };
});
vi.mock("../src/writing/initialsData", () => {
  const png = (c: string) => new Uint8Array(readFileSync(`assets/initials/illuminated/${c}.png`));
  const ttf = (n: string) => new Uint8Array(readFileSync(`assets/fonts/initials/${n}`));
  return {
    ILLUMINATED: Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => [c, png(c)])),
    OPENING_FONT_FILES: {
      fell: { name: "IMFELLDoublePica-Regular.ttf", data: ttf("IMFELLDoublePica-Regular.ttf"), weight: "normal" },
      jacquard: { name: "Jacquard24-Regular.ttf", data: ttf("Jacquard24-Regular.ttf"), weight: "normal" },
      cinzel: { name: "CinzelDecorative-Bold.ttf", data: ttf("CinzelDecorative-Bold.ttf"), weight: "bold" },
    },
  };
});
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
    expect(resolveOpening({ style: "nonsense" as never, frame: "x" as never, lines: 9 as never })).toEqual({ style: "art", frame: "none", lines: 2, matter: false });
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

import JSZip from "jszip";
import { buildDocx } from "../src/export/docx";
import { buildPdf } from "../src/export/pdf";
import { parseMarkdown } from "../src/export/model";

const manuscript = (): any => ({
  title: "T", subtitle: "", author: "A", surname: "S", contact: "", language: "en", words: 10, dedication: "", copyright: "", about: "", coverPath: null, identifier: "urn:x",
  acts: [{ title: "Act", titled: false, number: 1, chapters: [{ title: "One", number: 1, scenes: [{ title: "S", blocks: parseMarkdown("In the beginning.\n\nSecond paragraph.", { lineBreaksAreParagraphs: true, smartQuotes: false }) }] }] }],
});
const exportOpts = (opening: any): any => ({ docx: true, epub: true, pdf: true, preset: "trade", minStatus: "draft", lineBreaksAreParagraphs: true, smartQuotes: false, sceneBreak: "* * *", chapterStyle: "number-title", actTitles: false, trimSize: "5.5x8.5", opening });

describe("opening letter in Word and PDF", () => {
  it("Word gets a real drop cap in the chosen font, and nothing when off", async () => {
    const xml = async (o: any) => (await JSZip.loadAsync(await buildDocx(manuscript(), exportOpts(o), "* * *"))).file("word/document.xml")!.async("string");
    const on = await xml({ style: "cinzel", frame: "double", lines: 3 });
    expect(on).toContain('w:dropCap="drop"');
    expect(on).toContain('w:lines="3"');
    expect(on).toContain("Cinzel Decorative");
    expect(on).toContain("n the beginning.");
    expect(await xml({ style: "off", frame: "none", lines: 3 })).not.toContain("w:dropCap");
    const art = await xml({ style: "art", frame: "none", lines: 3 });
    expect(art).toContain("wp:anchor");
    expect(art).toContain("wrapSquare");
  });

  it("PDF still builds with every style", async () => {
    for (const style of ["off", "art", "fell", "jacquard", "cinzel"]) {
      const data = await buildPdf(manuscript(), exportOpts({ style, frame: "block", lines: 2 }), "* * *");
      expect(data.byteLength).toBeGreaterThan(1000);
    }
  });
});
