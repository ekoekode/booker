import { STYLES, type StyleId } from "../citations/styles";
import { App, Modal, Setting } from "obsidian";
import { DEFAULT_SCENE_DATES, type BreakStyle, type ChapterStyle, type ExportOptions } from "./headings";
import type { NoteNumbering, NotePlacement } from "./notes";
import type { Words } from "../profiles/words";
import { Advanced, FontFamily, PageSize, resolveLayout, Toggle } from "./layout";

/** Every layout choice an export can make. A blank field keeps the default of the chosen look, shown as a hint. */
export class AdvancedExportModal extends Modal {
  constructor(app: App, private opts: ExportOptions, private onSaved: () => void | Promise<void>, private words?: Words) {
    super(app);
  }

  private get adv(): Advanced {
    return (this.opts.advanced ??= {});
  }

  onOpen() {
    this.modalEl.addClass("booker-adv");
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Advanced export settings" });
    const d = resolveLayout({ preset: this.opts.preset, trimSize: this.opts.trimSize });
    const a = this.adv;
    const hint = (v: number) => `Default ${Math.round(v * 100) / 100}`;

    /** A number field: empty means "use the default". */
    const number = (parent: HTMLElement, name: string, desc: string, key: keyof Advanced, def: number) =>
      new Setting(parent)
        .setName(name)
        .setDesc(desc)
        .addText((t) => {
          t.inputEl.type = "number";
          t.inputEl.step = "any";
          t.inputEl.addClass("booker-adv-num");
          t.setPlaceholder(hint(def))
            .setValue(a[key] === undefined ? "" : String(a[key]))
            .onChange((v) => {
              const n = parseFloat(v);
              if (v.trim() === "" || !isFinite(n)) delete (a as any)[key];
              else (a as any)[key] = n;
            });
        });
    const toggle = (parent: HTMLElement, name: string, desc: string, key: "pageNumbers" | "runningHeader" | "justify", def: boolean) =>
      new Setting(parent)
        .setName(name)
        .setDesc(desc)
        .addDropdown((dd) =>
          dd
            .addOptions({ default: `Default (${def ? "on" : "off"})`, on: "On", off: "Off" })
            .setValue(a[key] ?? "default")
            .onChange((v) => ((a as any)[key] = v as Toggle))
        );
    const yesNo = (parent: HTMLElement, name: string, desc: string, key: "breakBeforeChapter" | "breakBeforeAct" | "titlePage") =>
      new Setting(parent).setName(name).setDesc(desc).addToggle((t) => t.setValue(a[key] ?? true).onChange((v) => ((a as any)[key] = v)));

    new Setting(contentEl).setName("Page").setHeading();
    new Setting(contentEl)
      .setName("Page size")
      .setDesc("Manuscripts default to US Letter. Books follow the trim size chosen in the export window.")
      .addDropdown((dd) =>
        dd
          .addOptions({ default: "Default for this look", letter: "US Letter", a4: "A4", a5: "A5", "5x8": "5 × 8 in", "5.5x8.5": "5.5 × 8.5 in", "6x9": "6 × 9 in", custom: "Custom…" })
          .setValue(a.pageSize ?? "default")
          .onChange((v) => {
            a.pageSize = v as PageSize;
            this.render();
          })
      );
    if (a.pageSize === "custom") {
      number(contentEl, "Width", "Inches.", "customWidth", d.pageW);
      number(contentEl, "Height", "Inches.", "customHeight", d.pageH);
    }
    number(contentEl, "Top margin", "Inches.", "marginTop", d.top);
    number(contentEl, "Bottom margin", "Inches.", "marginBottom", d.bottom);
    number(contentEl, "Inner margin", "Inches, on the binding side. For Word it is the left margin.", "marginInner", d.inner);
    number(contentEl, "Outer margin", "Inches.", "marginOuter", d.outer);
    new Setting(contentEl)
      .setName("Mirror margins on facing pages")
      .setDesc("The inner margin sits next to the binding on every page, left on odd pages and right on even ones. For Word and PDF; ePub pages reflow, so it does not apply there. Books default to on, manuscripts to off.")
      .addToggle((t) => t.setValue(a.mirrorMargins ? a.mirrorMargins === "on" : d.mirror).onChange((v) => (a.mirrorMargins = v ? "on" : "off")));

    new Setting(contentEl).setName("Text").setHeading();
    new Setting(contentEl)
      .setName("Font")
      .setDesc("PDF can use Times, Helvetica, Courier or the built-in book serif. Word and ePub can use any font installed on the reader's computer.")
      .addDropdown((dd) =>
        dd
          .addOptions({ default: "Default for this look", serif: "Book serif (Georgia)", times: "Times New Roman", sans: "Arial / Helvetica", mono: "Courier", custom: "Other font name…" })
          .setValue(a.fontFamily ?? "default")
          .onChange((v) => {
            a.fontFamily = v as FontFamily;
            this.render();
          })
      );
    if (a.fontFamily === "custom") {
      new Setting(contentEl)
        .setName("Font name")
        .setDesc("Used by Word and ePub. PDF falls back to the book serif.")
        .addText((t) => t.setPlaceholder("Garamond").setValue(a.customFont ?? "").onChange((v) => (a.customFont = v)));
    }
    number(contentEl, "Font size", "Points.", "fontSize", d.fontSize);
    number(contentEl, "Line spacing", "1 is single, 2 is double.", "lineSpacing", d.line);
    number(contentEl, "First-line indent", "Inches. 0 for none.", "firstLineIndent", d.indent);
    number(contentEl, "Space after paragraphs", "Points. Usually 0 when paragraphs are indented.", "paragraphSpacing", d.paraAfter);
    toggle(contentEl, "Justify text", "Straight right edge.", "justify", d.justify);

    new Setting(contentEl).setName("Structure").setHeading();
    const mid = (this.words ? (this.words.hasMid ? this.words.mid : this.words.item) : "Chapter").toLowerCase();
    const top = (this.words?.top ?? "Act").toLowerCase();
    yesNo(contentEl, `Start each ${mid} on a new page`, `Off runs ${mid}s on after a gap.`, "breakBeforeChapter");
    if (!this.words || this.words.hasTop) yesNo(contentEl, `Start each ${top} on a new page`, `Applies when ${top} title pages are on.`, "breakBeforeAct");
    yesNo(contentEl, "Title, copyright and dedication pages", "Off starts the file at the first chapter.", "titlePage");
    new Setting(contentEl)
      .setName(`${mid.charAt(0).toUpperCase()}${mid.slice(1)} headings`)
      .addDropdown((dd) =>
        dd
          .addOptions({ "number-title": `${mid.charAt(0).toUpperCase()}${mid.slice(1)} 1, then name`, title: "Name only", number: "Number only" })
          .setValue(this.opts.chapterStyle)
          .onChange((v) => (this.opts.chapterStyle = v as ChapterStyle))
      );
    if (!this.words || this.words.hasTop) new Setting(contentEl).setName(`${top.charAt(0).toUpperCase()}${top.slice(1)} title pages`).addToggle((t) => t.setValue(this.opts.actTitles).onChange((v) => (this.opts.actTitles = v)));
    new Setting(contentEl)
      .setName("Scene break style")
      .setDesc("Books only. Manuscripts always use #.")
      .addDropdown((dd) =>
        dd
          .addOptions({ custom: "My own mark (below)", stars: "* * *", dots: "\u2022 \u2022 \u2022", line: "\u2014\u2014\u2014 (a short line)", space: "Blank space only" })
          .setValue(this.opts.breakStyle ?? "custom")
          .onChange((v) => {
            this.opts.breakStyle = v as BreakStyle;
            this.render();
          })
      );
    if ((this.opts.breakStyle ?? "custom") === "custom")
      new Setting(contentEl)
        .setName("Scene break mark")
        .setDesc("Any short text, such as ❖ or ~ ~ ~. Fonts in PDF cover plain letters and common punctuation only.")
        .addText((t) => t.setValue(this.opts.sceneBreak).onChange((v) => (this.opts.sceneBreak = v || "* * *")));
    new Setting(contentEl)
      .setName("Scene titles")
      .setDesc("Print each scene's title as a small heading above it. Off by default; scenes are then separated only by the break.")
      .addToggle((t) => t.setValue(!!this.opts.sceneTitles).onChange((v) => (this.opts.sceneTitles = v)));

    const sd = (this.opts.sceneDates ??= { ...DEFAULT_SCENE_DATES });
    new Setting(contentEl)
      .setName("Section dates")
      .setDesc("Print each section's date (its Date property in the inspector) above it. Sections without a date print nothing.")
      .addToggle((t) =>
        t.setValue(sd.on).onChange((v) => {
          sd.on = v;
          this.render();
        })
      );
    if (sd.on) {
      new Setting(contentEl).setName("Date alignment").addDropdown((dd) => dd.addOptions({ left: "Left", center: "Centered", right: "Right" }).setValue(sd.align).onChange((v) => (sd.align = v as typeof sd.align)));
      new Setting(contentEl)
        .setName("Date size")
        .setDesc("Percent of the body text.")
        .addDropdown((dd) => dd.addOptions({ "90": "Smaller (90%)", "100": "Same as text (100%)", "115": "Larger (115%)", "130": "Large (130%)", "150": "Very large (150%)" }).setValue(String(sd.size)).onChange((v) => (sd.size = Number(v))));
      new Setting(contentEl).setName("Italic").addToggle((t) => t.setValue(sd.italic).onChange((v) => (sd.italic = v)));
      new Setting(contentEl).setName("Bold").addToggle((t) => t.setValue(sd.bold).onChange((v) => (sd.bold = v)));
      new Setting(contentEl).setName("Capital letters").addToggle((t) => t.setValue(sd.caps).onChange((v) => (sd.caps = v)));
      new Setting(contentEl)
        .setName("Write the date")
        .setDesc("A date Booker can read, such as 1891-03-12, can be spelled out. Anything else (Day 3, Spring) is printed as you typed it.")
        .addDropdown((dd) => dd.addOptions({ written: "As typed", long: "Spelled out (March 12, 1891)" }).setValue(sd.format).onChange((v) => (sd.format = v as typeof sd.format)));
      new Setting(contentEl).setName("Add the time").setDesc("Follow the date with the section's Time property.").addToggle((t) => t.setValue(sd.time).onChange((v) => (sd.time = v)));
    }

    new Setting(contentEl).setName("Footnotes and sources").setHeading();
    new Setting(contentEl)
      .setName("Bibliography")
      .setDesc("List the sources you cited with [@key] at the end of the book, in the style chosen below.")
      .addToggle((t) => t.setValue(this.opts.bibliography !== false).onChange((v) => (this.opts.bibliography = v)));
    new Setting(contentEl)
      .setName("Scripture index")
      .setDesc("List every scripture reference in the text at the end of the book, with the chapters it appears in. The default follows the kind of book.")
      .addDropdown((d) =>
        d
          .addOptions({ auto: "Follow the kind of book", on: "Include", off: "Leave out" })
          .setValue(this.opts.scriptureIndex === undefined ? "auto" : this.opts.scriptureIndex ? "on" : "off")
          .onChange((v) => (this.opts.scriptureIndex = v === "auto" ? undefined : v === "on"))
      );
    new Setting(contentEl)
      .setName("Index")
      .setDesc("Print an index of the words and names listed in the book's indexTerms property, with the chapters they appear in.")
      .addToggle((t) => t.setValue(this.opts.bookIndex !== false).onChange((v) => (this.opts.bookIndex = v)));
    new Setting(contentEl)
      .setName("Use “Ibid.”")
      .setDesc("In Chicago and SBL, a note that cites the same source as the note just before it reads “Ibid.” (with the page when there is one).")
      .addToggle((t) => t.setValue(this.opts.ibid ?? false).onChange((v) => (this.opts.ibid = v)));
    new Setting(contentEl)
      .setName("Citation style")
      .setDesc("Chicago and SBL put each citation in a footnote. APA and MLA write it in the text and call the list References or Works Cited. Left on the book's own style unless you pick one.")
      .addDropdown((dd) => {
        dd.addOption("__own__", "The book's own style");
        for (const st of STYLES) dd.addOption(st.id, st.name);
        dd.setValue(this.opts.citationStyle ?? "__own__").onChange((v) => (this.opts.citationStyle = v === "__own__" ? undefined : (v as StyleId)));
      });
    new Setting(contentEl)
      .setName("Where notes are printed")
      .setDesc("Foot of the page is real footnotes in Word. In PDF they are set at the foot of the page, long notes carrying over. In ePub it means the end of the chapter.")
      .addDropdown((dd) =>
        dd
          .addOptions({ bottom: "Foot of the page", chapter: "End of each chapter", book: "End of the book" })
          .setValue(this.opts.notePlacement ?? "bottom")
          .onChange((v) => (this.opts.notePlacement = v as NotePlacement))
      );
    new Setting(contentEl)
      .setName("Numbering")
      .setDesc("Word numbers page-bottom footnotes straight through the book.")
      .addDropdown((dd) =>
        dd
          .addOptions({ chapter: "Start again in each chapter", book: "Run through the book" })
          .setValue(this.opts.noteNumbering ?? "chapter")
          .onChange((v) => (this.opts.noteNumbering = v as NoteNumbering))
      );

    new Setting(contentEl).setName("Headers and numbering").setHeading();
    toggle(contentEl, "Page numbers", "", "pageNumbers", d.pageNumbers);
    toggle(contentEl, "Running header", "Author and title on each page.", "runningHeader", d.runningHeader);

    new Setting(contentEl).setName("Text processing").setHeading();
    new Setting(contentEl)
      .setName("Each new line is a paragraph")
      .setDesc("On: matches how Obsidian shows your text. Off: lines are joined until a blank line.")
      .addToggle((t) => t.setValue(this.opts.lineBreaksAreParagraphs).onChange((v) => (this.opts.lineBreaksAreParagraphs = v)));
    new Setting(contentEl).setName("Curly quotes, dashes and ellipses").addToggle((t) => t.setValue(this.opts.smartQuotes).onChange((v) => (this.opts.smartQuotes = v)));

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Reset to defaults").onClick(() => {
          this.opts.advanced = {};
          this.render();
        })
      )
      .addButton((b) =>
        b
          .setButtonText("Done")
          .setCta()
          .onClick(async () => {
            await this.onSaved();
            this.close();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
