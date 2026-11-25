import { Modal, Setting, TFile } from "obsidian";
import type BookerPlugin from "../main";
import type { HubScene } from "../project/hubModel";

const MIN_WORDS = 100;

/** Asks before writing the AI summaries of a whole book: what it will do, what it costs, and whether to fill the gaps or redo every one. */
export class BulkSummaryModal extends Modal {
  constructor(private plugin: BookerPlugin, private scenes: HubScene[], private item = "scene") {
    super(plugin.app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Write AI summaries" });
    // an item with a summary of your own is never touched; one under the minimum is too short to summarise
    const eligible = this.scenes.filter((s) => !s.ownSummary && s.words >= MIN_WORDS);
    const missing = eligible.filter((s) => !s.aiShort);
    const go = (list: HubScene[]) => {
      this.close();
      const files = list.map((s) => this.plugin.app.vault.getAbstractFileByPath(s.path)).filter((f): f is TFile => f instanceof TFile);
      void this.plugin.autoSummary.many(files);
    };
    contentEl.createEl("p", { cls: "booker-warning", text: `This runs on your computer, one ${this.item} at a time, and can take a while. Progress is in the task viewer.` });
    new Setting(contentEl)
      .setName(`Missing (${missing.length})`)
      .addButton((b) => b.setButtonText("Write missing").setCta().setDisabled(!missing.length).onClick(() => go(missing)));
    new Setting(contentEl)
      .setName(`All (${eligible.length})`)
      .setDesc("Replaces existing summaries.")
      .addButton((b) => b.setButtonText("Refresh all").setWarning().setDisabled(!eligible.length).onClick(() => go(eligible)));
    new Setting(contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
