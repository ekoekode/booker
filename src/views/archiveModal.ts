import { App, Modal } from "obsidian";
import { actTitle, chapterTitle, type Labels } from "../project/format";
import type { Words } from "../profiles/words";
import { Archived } from "../project/vaultOps";
import { actionBtn, actionRow } from "../ui";

/** The items that were taken out of the book, with a button to bring each one back. */
export class ArchiveModal extends Modal {
  constructor(app: App, private list: () => Archived[], private onRestore: (a: Archived) => Promise<void>, private onOpen_: (a: Archived) => void, private w: Words, private labels: Labels) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(`Archived ${this.w.itemMany.toLowerCase()}`);
    this.draw();
  }

  private draw() {
    const { contentEl } = this;
    contentEl.empty();
    const items = this.list();
    if (!items.length) return void contentEl.createEl("p", { cls: "booker-muted", text: `Nothing is archived. Archive a ${this.w.item.toLowerCase()} to take it out of the book without deleting it.` });
    contentEl.createEl("p", { cls: "booker-muted", text: `Restoring puts a ${this.w.item.toLowerCase()} back at the end of ${this.w.hasMid ? `the ${this.w.mid.toLowerCase()}` : this.w.hasTop ? `the ${this.w.top.toLowerCase()}` : "the book"} it came from.` });
    for (const a of items) {
      const row = contentEl.createDiv({ cls: "booker-archive-row" });
      const info = row.createDiv({ cls: "booker-archive-info" });
      const t = info.createEl("a", { text: a.title });
      t.onclick = () => {
        this.onOpen_(a);
        this.close();
      };
      info.createSpan({ cls: "booker-muted", text: `${[this.w.hasTop ? actTitle(a.act, this.labels, this.w.top) : "", this.w.hasMid && a.chapter !== undefined ? chapterTitle(a.chapter, this.labels, this.w.mid) : ""].filter(Boolean).map((x) => `${x} · `).join("")}${a.words.toLocaleString()} words` });
      actionBtn(
        actionRow(row),
        "Restore",
        "archive-restore",
        async () => {
          await this.onRestore(a);
          this.draw();
        },
        { cta: true, tip: `Put “${a.title}” back in the book` }
      );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
