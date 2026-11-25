import { App, Modal, Notice, Setting } from "obsidian";
import { moveInOrder, reconcileOrder } from "../project/series";
import { findProjects, Project, readSeries, writeSeries } from "../project/vaultOps";
import { notifyError } from "../ui";

/** A series' own settings: its name and the order of its books. */
export class SeriesSettingsModal extends Modal {
  private order: string[] = [];
  private name = "";

  constructor(app: App, private proj: Project, private onChanged: () => void) {
    super(app);
  }

  async onOpen() {
    const folder = this.proj.series!.folder;
    const meta = await readSeries(this.app, folder);
    const existing = findProjects(this.app).filter((p) => p.series?.folder === folder).map((p) => p.name);
    this.order = reconcileOrder(meta?.bookOrder ?? [], existing);
    this.name = meta?.name ?? this.proj.series!.name;
    this.draw();
  }

  private draw() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `${this.proj.series!.name}: series settings` });

    new Setting(contentEl)
      .setName("Series name")
      .setDesc("The name shown for the series. The folder keeps its name.")
      .addText((t) => t.setValue(this.name).onChange((v) => (this.name = v)));

    contentEl.createEl("h4", { text: "Books, in reading order" });
    this.order.forEach((book, i) => {
      new Setting(contentEl)
        .setName(`${i + 1}. ${book}`)
        .addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Earlier").setDisabled(i === 0).onClick(() => this.move(book, -1)))
        .addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Later").setDisabled(i === this.order.length - 1).onClick(() => this.move(book, 1)));
    });
    contentEl.createEl("p", { cls: "booker-muted", text: "The order is used when the whole series is shown on the plotlines and timelines. Adding a book to a series, or taking one out, comes later." });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Save").setCta().onClick(() => void this.save()));
  }

  private move(book: string, dir: -1 | 1) {
    this.order = moveInOrder(this.order, book, dir);
    this.draw();
  }

  private async save() {
    const folder = this.proj.series!.folder;
    try {
      const meta = (await readSeries(this.app, folder)) ?? { name: this.name, bookOrder: [], created: "" };
      await writeSeries(this.app, folder, { ...meta, name: this.name.trim() || meta.name, bookOrder: this.order });
      new Notice("Series saved.");
      this.close();
      this.onChanged();
    } catch (e) {
      notifyError(e, "save the series");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
