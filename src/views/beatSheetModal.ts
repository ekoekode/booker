import { App, Modal } from "obsidian";
import type { BeatSheet } from "../project/beats";
import { actionBtn, actionRow } from "../ui";

/** Choose a story structure. It names the acts after it and can add a scene for every beat. */
export class BeatSheetModal extends Modal {

  constructor(app: App, private sheets: BeatSheet[], private current: string | undefined, private onApply: (sheet: BeatSheet, makeScenes: boolean) => Promise<void>) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Beat sheet");
    const { contentEl } = this;
    contentEl.createEl("p", { cls: "booker-muted", text: "A beat sheet is a list of the moments a book or talk of that shape usually needs. Use names your parts after it and adds nothing else. Add sections also adds a chapter and a section for each beat that does not have one yet." });
    if (!this.sheets.length) contentEl.createEl("p", { cls: "booker-muted", text: "This kind of book has no outlines yet. Add `beatSheets` to its profile in the profiles file to offer your own." });
    for (const sheet of this.sheets) {
      const card = contentEl.createDiv({ cls: "booker-beat-card" });
      const head = card.createDiv({ cls: "booker-beat-head" });
      const info = head.createDiv();
      info.createEl("strong", { text: sheet.name + (this.current === sheet.name ? "  (in use)" : "") });
      info.createDiv({ cls: "booker-muted", text: `${sheet.summary} ${sheet.beats.length} beats.` });
      const btns = actionRow(head);
      actionBtn(
        btns,
        "Use",
        "check",
        async () => {
          this.close();
          await this.onApply(sheet, false);
        },
        { cta: true, tip: `Follow ${sheet.name}: names the acts, adds nothing else` }
      );
      actionBtn(
        btns,
        "Add scenes",
        "plus",
        async () => {
          this.close();
          await this.onApply(sheet, true);
        },
        { tip: "Follow it and add a chapter and a scene for each beat that has none yet" }
      );
      const more = card.createEl("details");
      more.createEl("summary", { text: "Show beats" });
      for (const b of sheet.beats) {
        const row = more.createDiv({ cls: "booker-beat-item" });
        row.createSpan({ cls: "booker-muted", text: `${sheet.actLabels[b.act]} · ` });
        row.createEl("strong", { text: b.label });
        row.createDiv({ cls: "booker-muted", text: b.description });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
