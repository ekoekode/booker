import { App, Modal, Setting } from "obsidian";
import { parseStoryDate } from "../dates";

/** Name and date a timeline event made from a quotation. */
export class EventModal extends Modal {
  constructor(app: App, private quote: string, private name: string, private date: string, private projectName: string, private onSubmit: (name: string, date: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Add to the timeline");
    contentEl.createEl("p", { cls: "booker-muted", text: `A dated note in ${this.projectName}'s Codex, so the quotation appears on the timeline map.` });
    contentEl.createEl("blockquote", { text: this.quote.length > 240 ? `${this.quote.slice(0, 240)}…` : this.quote });
    const status = contentEl.createDiv({ cls: "booker-muted" });
    new Setting(contentEl).setName("Name").addText((t) => t.setValue(this.name).onChange((v) => (this.name = v)));
    const check = () => {
      const w = parseStoryDate(this.date);
      status.setText(this.date.trim() ? (w ? `Placed: ${w.display}` : "The timeline cannot read this date. Try 1342, 10 June 1342, c. 1200 or 586 BC.") : "Add a date.");
      return !!w;
    };
    new Setting(contentEl).setName("Date").addText((t) => t.setValue(this.date).onChange((v) => {
      this.date = v;
      check();
    }));
    check();
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Add event").setCta().onClick(() => {
        if (!this.name.trim() || !check()) return;
        this.close();
        this.onSubmit(this.name.trim(), this.date.trim());
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}
