import { Modal, Notice, Setting } from "obsidian";
import type BookerPlugin from "../main";
import type { Source } from "../sources/types";
import { ConfirmModal } from "../ui";

const ALL = "*";

/** Index the library for searching by meaning: lazy (only what is missing) or reindex, for every database or one. The work runs in the background and shows in the hub's task list. */
export class IndexModal extends Modal {
  private target = ALL;
  private mode: "lazy" | "reindex" = "lazy";

  constructor(private plugin: BookerPlugin) {
    super(plugin.app);
  }

  onOpen() {
    this.titleEl.setText("Index");
    const sources = this.plugin.sources();
    new Setting(this.contentEl).setName("Index").addDropdown((d) => {
      d.addOption(ALL, "All databases");
      for (const s of sources) d.addOption(s.uid, s.title || s.uid);
      d.setValue(this.target).onChange((v) => (this.target = v));
    });
    new Setting(this.contentEl)
      .setName("How")
      .addDropdown((d) => {
        d.addOption("lazy", "Lazy: only what is missing");
        d.addOption("reindex", "Reindex: clear and rebuild");
        d.setValue(this.mode).onChange((v) => (this.mode = v as "lazy" | "reindex"));
      });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Start").setCta().onClick(() => this.start()))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
    const list = this.contentEl.createDiv({ cls: "booker-index-list" });
    void this.status(list, sources);
  }

  private async status(list: HTMLElement, sources: Source[]) {
    for (const s of sources) {
      const st = await this.plugin.semanticIndex.status(s);
      const left = (this.plugin.scriptureData().semanticSkip ?? []).includes(s.uid) ? ", switched off" : "";
      const label = st.state === "none" ? "not indexed" : st.state === "done" ? `indexed (${st.total} passages)` : `partly indexed (${st.count} of ${st.total})`;
      new Setting(list).setName(s.title || s.uid).setDesc(label + left);
    }
  }

  private chosen(): Source[] {
    const all = this.plugin.sources();
    return this.target === ALL ? all : all.filter((s) => s.uid === this.target);
  }

  private start() {
    const list = this.chosen();
    if (!list.length) return void new Notice("Booker: nothing to index.");
    const run = () => {
      this.close();
      new Notice("Booker: indexing started. It runs in the background; follow it under Background tasks in the hub.");
      void this.plugin.semanticIndex.indexAll(list, undefined, this.target !== ALL, this.mode === "reindex").catch((e) => new Notice(`Booker: indexing stopped. ${e instanceof Error ? e.message : e}`));
    };
    if (this.mode === "reindex") new ConfirmModal(this.app, "Reindex?", `The index of ${list.length === 1 ? "this database" : `${list.length} databases`} is deleted and made again. This can take a while.`, "Reindex", run).open();
    else run();
  }

  onClose() {
    this.contentEl.empty();
  }
}
