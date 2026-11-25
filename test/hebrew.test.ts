import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

vi.mock("../src/export/fonts", () => {
  const f = (n: string) => new Uint8Array(readFileSync(`assets/fonts/Literata-${n}.ttf`));
  const data = { regular: f("Regular"), italic: f("Italic"), bold: f("Bold"), boldItalic: f("BoldItalic") };
  return { FONTS: data, FONT_FILES: [], HEBREW_FONT: new Uint8Array(readFileSync("assets/fonts/NotoSerifHebrew-Regular.woff")) };
});

import { buildDocx } from "../src/export/docx";
import { buildEpub } from "../src/export/epub";
import { buildPdf } from "../src/export/pdf";
import { parseMarkdown } from "../src/export/model";
import { scriptSegments, stripPoints, visualHebrew } from "../src/export/script";

const opts: any = { docx: true, epub: true, pdf: true, preset: "trade", minStatus: "draft", lineBreaksAreParagraphs: true, smartQuotes: false, sceneBreak: "*", chapterStyle: "number-title", actTitles: false, trimSize: "5.5x8.5" };
const md = "The first word is בְּרֵאשִׁית, meaning beginning, and אֱלֹהִים בָּרָא follows in the text of Genesis.\n\nבְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ";
const ms = () => ({ title: "T", subtitle: "", author: "A", surname: "A", contact: "", language: "en", words: 5, dedication: "", copyright: "", about: "", coverPath: null, identifier: "x",
  acts: [{ title: "A", titled: false, number: 1, chapters: [{ title: "One", number: 1, scenes: [{ title: "s", blocks: parseMarkdown(md, { lineBreaksAreParagraphs: true, smartQuotes: false }) }] }] }] }) as any;

describe("Hebrew", () => {
  it("finds Hebrew stretches and orders them for drawing", () => {
    const segs = scriptSegments("say אל בן, then more");
    expect(segs.map((s) => s.he)).toEqual([false, true, false]);
    expect(segs[1].t).toBe("אל בן");
    expect(visualHebrew("אֱב")).toBe("באֱ");
    expect(stripPoints("בְּר")).toBe("בר");
  });
  it("sets Hebrew right to left in Word and ePub, and embeds a font in PDF", async () => {
    const doc = await (await JSZip.loadAsync(await buildDocx(ms(), opts, "*"))).file("word/document.xml")!.async("string");
    expect(doc).toContain("<w:rtl");
    const ch = await (await JSZip.loadAsync(await buildEpub(ms(), opts, "*", null))).file("OEBPS/text/ch001.xhtml")!.async("string");
    expect(ch).toContain('class="he" lang="he" dir="rtl"');
    const pdf = await buildPdf(ms(), opts, "*");
    expect(pdf.byteLength).toBeGreaterThan(5000);
  });
});

import { findEntries, formatStudy, guessStudy, strongsKey } from "../src/scripture/wordstudy";

describe("word study", () => {
  const entries = [
    { word: "H430", text: "<b>אֱלֹהִים</b> 'elohiym <i>plural of</i> H433; God, gods, judges.<br>Second line." },
    { word: "H1254", text: "בָּרָא bara' to create, shape; to cut down." },
    { word: "G26", text: "agape love" },
  ];
  it("finds Strong's numbers however they are written, and words", () => {
    expect(strongsKey("h0430")).toBe("H430");
    expect(findEntries(entries, "h430")[0].word).toBe("H430");
    expect(findEntries(entries, "430")[0].word).toBe("H430");
    expect(findEntries(entries, "ברא").map((e) => e.word)).toEqual(["H1254"]);
    expect(findEntries(entries, "create").map((e) => e.word)).toEqual(["H1254"]);
    expect(findEntries(entries, "agape")[0].word).toBe("G26");
  });
  it("guesses the fields and formats them", () => {
    const s = guessStudy(entries[0]);
    expect(s).toMatchObject({ hebrew: "אֱלֹהִים", translit: "'elohiym", strongs: "H430" });
    expect(formatStudy({ hebrew: "בָּרָא", translit: "bara'", gloss: "to create", strongs: "H1254" }, "inline")).toBe("**בָּרָא** (*bara'*, H1254): to create");
  });
});

describe("word study gloss", () => {
  it("drops the pronunciation guide in front of the meaning", () => {
    const s = guessStudy({ word: "H430", text: "אֱלֹהִים elohiym el-o-heem' plural of H433; gods" });
    expect(s.gloss.startsWith("plural of")).toBe(true);
  });
});
