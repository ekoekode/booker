import { App, Modal } from "obsidian";
import { diffCounts, diffLines } from "../project/notes";
import { parseNote } from "../project/format";

/** What changed between a saved version of a scene and the scene now, line by line. */
export class SnapshotDiff extends Modal {
  constructor(app: App, private heading: string, private older: string, private newer: string) {
    super(app);
  }

  onOpen() {
    const body = (t: string) => parseNote(t).body.trim();
    const d = diffLines(body(this.older), body(this.newer));
    const { added, removed } = diffCounts(d);
    this.modalEl.addClass("booker-diff-modal");
    this.titleEl.setText(this.heading);
    const { contentEl } = this;
    contentEl.createEl("p", { cls: "booker-muted", text: added || removed ? `${added} line${added === 1 ? "" : "s"} added, ${removed} removed since this version.` : "No difference in the text." });
    const box = contentEl.createDiv({ cls: "booker-diff" });
    // keep two lines either side of a change and fold the rest
    const keep = d.map((x, i) => x.kind !== "same" || d.slice(Math.max(0, i - 2), i + 3).some((y) => y.kind !== "same"));
    let folded = 0;
    const flush = () => {
      if (folded) box.createDiv({ cls: "booker-diff-fold", text: `… ${folded} unchanged line${folded === 1 ? "" : "s"}` });
      folded = 0;
    };
    d.forEach((x, i) => {
      if (!keep[i]) return void folded++;
      flush();
      const row = box.createDiv({ cls: `booker-diff-line is-${x.kind}` });
      row.createSpan({ cls: "booker-diff-mark", text: x.kind === "add" ? "+" : x.kind === "del" ? "−" : "" });
      row.createSpan({ text: x.text || " " });
    });
    flush();
  }

  onClose() {
    this.contentEl.empty();
  }
}
