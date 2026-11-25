import { App, Modal, Setting } from "obsidian";
import { describeDuration } from "../generate/chunk";

/** A window that shows how far a long job has got, with a Cancel button. Closing it also cancels. */
export class ProgressModal extends Modal {
  cancelled = false;
  private bar!: HTMLProgressElement;
  private stepEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private started = Date.now();
  private finished = false;

  constructor(app: App, private heading: string, private onCancel?: () => void) {
    super(app);
  }

  onOpen() {
    this.contentEl.createEl("h3", { text: this.heading });
    this.stepEl = this.contentEl.createEl("p", { text: "Starting…" });
    this.bar = this.contentEl.createEl("progress", { attr: { max: "1", value: "0" } });
    this.bar.style.width = "100%";
    this.timeEl = this.contentEl.createEl("p", { cls: "booker-muted" });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  update(p: { step: string; done: number; total: number }) {
    if (!this.stepEl) return;
    this.stepEl.setText(`${p.step} (${p.done} of ${p.total} steps done)`);
    this.bar.max = Math.max(1, p.total);
    this.bar.value = p.done;
    const elapsed = (Date.now() - this.started) / 1000;
    this.timeEl.setText(p.done > 0 ? `Elapsed ${describeDuration(elapsed)}. ${describeDuration((elapsed / p.done) * (p.total - p.done))} to go.` : "Working out how long it will take…");
  }

  /** Close without counting it as a cancel. */
  finish() {
    this.finished = true;
    this.close();
  }

  onClose() {
    if (!this.finished && !this.cancelled) {
      this.cancelled = true;
      this.onCancel?.();
    }
    this.contentEl.empty();
  }
}
