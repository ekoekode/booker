import { Modal, Notice, Setting } from "obsidian";
import type BookerPlugin from "../main";
import { parseCopy, type CopySettings } from "../reader/copySettings";

/** The global default for how copied words are written, and a version for just this window. */
export function currentDefault(plugin: BookerPlugin): CopySettings {
  return parseCopy(plugin.scriptureData().copy);
}

export class CopySettingsModal extends Modal {
  private s: CopySettings;

  /** `current` is what the window uses now; `use` is called to use the settings in this window until it is closed. */
  constructor(private plugin: BookerPlugin, current: CopySettings, private use: (s: CopySettings) => void) {
    super(plugin.app);
    this.s = { ...current };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Copy settings" });
    const toggle = (name: string, key: Exclude<keyof CopySettings, "asQuote">, desc = "") =>
      new Setting(contentEl).setName(name).setDesc(desc).addToggle((t) => t.setValue(this.s[key]).onChange((v) => (this.s[key] = v)));
    toggle("Verse numbers", "verseNumbers");
    toggle("Verse numbers as superscripts", "superscript");
    toggle("Chapter numbers", "chapterNumbers", "3:16, not just 16.");
    toggle("… between verses that are apart", "ellipsis");
    toggle("Letters for footnotes", "letters", "a, b, c instead of 1, 2, 3.");
    new Setting(contentEl).setName("Write as").addDropdown((d) =>
      d.addOption("quote", "Quote block").addOption("inline", "Inline, in quotation marks").setValue(this.s.asQuote ? "quote" : "inline").onChange((v) => (this.s.asQuote = v === "quote"))
    );
    new Setting(contentEl)
      .setDesc("Use here lasts until this window is closed.")
      .addButton((b) =>
        b.setButtonText("Use here").onClick(() => {
          this.use({ ...this.s });
          new Notice("Booker: copy settings used in this window.");
          this.close();
        })
      )
      .addButton((b) =>
        b.setButtonText("Set default").setCta().onClick(async () => {
          await this.plugin.saveScripture({ ...this.plugin.scriptureData(), copy: { ...this.s } });
          this.use({ ...this.s });
          new Notice("Booker: default copy settings saved.");
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
