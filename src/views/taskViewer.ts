import { Modal, Setting } from "obsidian";
import type BookerPlugin from "../main";
import { describeDuration } from "../generate/chunk";
import type { BgTask } from "../tasks/tracker";

const LABEL: Record<BgTask["state"], string> = { queued: "Waiting", running: "Working", done: "Done", failed: "Failed", cancelled: "Cancelled", skipped: "Skipped" };

/** The background jobs: summaries and indexing, with progress and a Cancel for each. Updates while it is open. */
export class TaskViewer extends Modal {
  private off: (() => void) | null = null;
  private list!: HTMLElement;
  private tick: number | null = null;

  constructor(private plugin: BookerPlugin) {
    super(plugin.app);
  }

  onOpen() {
    this.contentEl.addClass("booker-tasks-viewer");
    this.contentEl.createEl("h3", { text: "Background tasks" });
    this.list = this.contentEl.createDiv();
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Clear finished").onClick(() => this.plugin.tasks.clearFinished()));
    this.off = this.plugin.tasks.subscribe(() => this.draw());
    this.tick = window.setInterval(() => this.draw(), 1000);
    this.draw();
  }

  onClose() {
    this.off?.();
    if (this.tick !== null) window.clearInterval(this.tick);
  }

  private draw() {
    const tasks = [...this.plugin.tasks.tasks()].reverse();
    this.list.empty();
    if (!tasks.length) return void this.list.createEl("p", { cls: "booker-muted", text: "Nothing is running. Summaries and indexing show up here while they work." });
    for (const t of tasks) {
      const row = this.list.createDiv({ cls: `booker-task-row is-${t.state}` });
      const head = row.createDiv({ cls: "booker-task-head" });
      head.createSpan({ cls: "booker-task-title", text: t.title });
      head.createSpan({ cls: "booker-muted", text: this.status(t) });
      if (t.state === "running" && t.total > 0) {
        const bar = row.createEl("progress");
        bar.max = t.total;
        bar.value = t.done;
        bar.style.width = "100%";
      }
      if (t.detail) row.createDiv({ cls: "booker-muted booker-task-detail", text: t.detail });
      if (t.cancel) new Setting(row).addButton((b) => b.setButtonText(t.state === "queued" ? "Remove" : "Cancel").onClick(() => t.cancel?.()));
    }
  }

  private status(t: BgTask): string {
    if (t.state === "running" && t.started) return `${LABEL.running}, ${describeDuration(Math.max(1, (Date.now() - t.started) / 1000)).replace("about ", "")}`;
    return LABEL[t.state];
  }
}
