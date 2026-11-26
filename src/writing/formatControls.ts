import { Setting } from "obsidian";
import { isFontStyle, OPENING_FRAME_LABELS, OPENING_STYLE_LABELS, type Opening } from "./initials";
import type { WritingFormat } from "./format";
import type { FormatBundle } from "./projectFormat";

/** The writing-format controls, shared by the plugin's default settings and a project's own settings. `get` reads what is shown; `set` stores a change; `redraw` draws the controls again. */
export function drawFormatControls(
  writing: HTMLElement,
  opening: HTMLElement,
  get: () => FormatBundle,
  set: (patch: { writing?: Partial<WritingFormat>; opening?: Partial<Opening> }) => Promise<void>,
  redraw: () => void
) {
  const w = () => get().writing;
  const o = () => get().opening;
  const setW = (patch: Partial<WritingFormat>) => void set({ writing: patch });
  const num = (name: string, desc: string, key: "indent" | "paragraphGap" | "dialogueGap", step: number, max: number) =>
    new Setting(writing)
      .setName(name)
      .setDesc(desc)
      .addSlider((sl) => sl.setLimits(0, max, step).setValue(w()[key]).setDynamicTooltip().onChange((v) => setW({ [key]: v })));
  new Setting(writing)
    .setName("Typeset scenes while writing")
    .setDesc("Indents and spacing show in the editor only; your text is unchanged.")
    .addToggle((t) => t.setValue(w().on).onChange((v) => setW({ on: v })));
  new Setting(writing)
    .setName("Book styling")
    .setDesc("Typeset paragraph indents and the large first letter of each chapter in the editor. Off sets paragraphs flush left, with no large letter. Also in a note's ⋯ menu.")
    .addToggle((t) => t.setValue(w().autoIndent).onChange((v) => setW({ autoIndent: v })));
  num("First-line indent", "In em. 0 turns it off.", "indent", 0.25, 4);
  num("Paragraph spacing", "Extra space before each paragraph, in em.", "paragraphGap", 0.1, 2);
  num("Dialogue spacing", "Extra space before dialogue lines, in em.", "dialogueGap", 0.1, 2);
  new Setting(writing)
    .setName("Indent after headings and scene breaks")
    .setDesc("Off follows book convention: the first paragraph of a scene is not indented.")
    .addToggle((t) => t.setValue(w().indentFirst).onChange((v) => setW({ indentFirst: v })));
  new Setting(writing)
    .setName("Write in the book's font")
    .setDesc("Show paragraphs in Literata, the font exported books use.")
    .addToggle((t) => t.setValue(w().bookFont).onChange((v) => setW({ bookFont: v })));
  new Setting(writing)
    .setName("Formatting bar")
    .setDesc("Bold, italic, headings, quote and scene break buttons above the editor.")
    .addToggle((t) => t.setValue(w().bar).onChange((v) => setW({ bar: v })));
  new Setting(writing)
    .setName("Tab indents a paragraph")
    .setDesc("Tab at a line start adds an em space; Shift+Tab removes it.")
    .addToggle((t) => t.setValue(w().tabIndent).onChange((v) => setW({ tabIndent: v })));

  const setO = async (patch: Partial<Opening>) => {
    await set({ opening: patch });
    redraw();
  };
  new Setting(opening)
    .setName("First letter")
    .setDesc("A large first letter on the first paragraph of each chapter, in the editor (while Book styling is on) and in exported ePub, PDF and Word books. The text wraps beside it and underneath.")
    .addDropdown((d) => d.addOptions(OPENING_STYLE_LABELS).setValue(o().style).onChange((v) => void setO({ style: v as Opening["style"] })));
  if (isFontStyle(o().style))
    new Setting(opening)
      .setName("Frame")
      .setDesc("Drawn around the letter in the text colour.")
      .addDropdown((d) => d.addOptions(OPENING_FRAME_LABELS).setValue(o().frame).onChange((v) => void setO({ frame: v as Opening["frame"] })));
  if (o().style !== "off")
    new Setting(opening)
      .setName("Also on front and back matter")
      .setDesc("Off shows the large letter on chapters and sections only. On also puts it on the first paragraph of the book's front and back matter.")
      .addToggle((t) => t.setValue(o().matter === true).onChange((v) => void setO({ matter: v })));
  if (o().style !== "off")
    new Setting(opening)
      .setName("Height")
      .setDesc("How many lines of text the letter is as tall as.")
      .addDropdown((d) => d.addOptions({ "2": "2 lines", "3": "3 lines", "4": "4 lines" }).setValue(String(o().lines)).onChange((v) => void setO({ lines: Number(v) as Opening["lines"] })));
}
