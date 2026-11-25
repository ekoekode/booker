import { Modal, Notice, Setting } from "obsidian";
import type BookerPlugin from "../main";
import { chunkText, describeDuration, estimateSeconds, planCalls, WARN_AFTER_SECONDS } from "../generate/chunk";
import { grounded } from "../generate/background";
import { Cancelled, summarizeLong } from "../generate/mapreduce";
import type { GenInfo } from "../generate/types";
import { defaultLength, pickSentences, splitSentences } from "../semantic/summary";
import { ConfirmModal } from "../ui";
import { ProgressModal } from "./progressModal";

const MAX_SENTENCES = 1500;
export type Kind = "sentences" | "written";

/** Two kinds of summary: the text's own best sentences (chosen by meaning), or new sentences written by a small model from every part of it. */
export class SummaryModal extends Modal {
  private sentences: string[] = [];
  private vectors: Float32Array[] = [];
  private count = 3;
  private written = "";
  private writtenBy = "";
  private kind: Kind = "sentences";
  private gen: GenInfo | null = null;
  private body!: HTMLElement;
  private out!: HTMLElement;
  private actions!: HTMLElement;

  constructor(private plugin: BookerPlugin, private text: string, private title: string, private prefer: Kind = "sentences") {
    super(plugin.app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("booker-summary");
    contentEl.createEl("h3", { text: `Summary: ${this.title}` });
    this.gen = (await this.plugin.gen.models(true))[0] ?? null;
    if (this.gen && this.prefer === "written") this.kind = "written";
    if (!this.gen && this.prefer === "written") {
      new Setting(contentEl)
        .setName("No writing model is installed")
        .setDesc("A written summary needs a small writing model, so the best sentences of the text are shown instead. Get a model in the Resource manager.")
        .addButton((b) =>
          b.setButtonText("Open Resource manager").onClick(() => {
            this.close();
            this.plugin.runCommand("resource-manager");
          })
        );
    }
    if (this.gen) {
      new Setting(contentEl)
        .setName("Kind")
        .setDesc("Best sentences quotes the text. Written summary is new wording from a small model: slower, and it can get things wrong.")
        .addDropdown((d) =>
          d.addOption("sentences", "Best sentences").addOption("written", "Written summary").setValue(this.kind).onChange((v) => {
            this.kind = v as Kind;
            void this.draw();
          })
        );
    }
    this.body = contentEl.createDiv();
    void this.draw();
  }

  private async draw() {
    this.body.empty();
    if (this.kind === "written") return this.drawWritten();
    await this.drawSentences();
  }

  // ---------------------------------------------------------------- best sentences

  private async drawSentences() {
    const body = this.body;
    const status = body.createEl("p", { cls: "booker-muted", text: "Reading…" });
    if (!this.vectors.length) {
      this.sentences = splitSentences(this.text).slice(0, MAX_SENTENCES);
      if (this.sentences.length < 2) return void status.setText("There is too little text here to summarise.");
      try {
        const info = await this.plugin.semanticIndex.model();
        if (!info) throw new Error("No search model is installed (see Settings → Search by meaning).");
        const e = await this.plugin.semantic.embedder(info);
        this.vectors = await e.embed(this.sentences, (d, t) => status.setText(`Reading… ${d} of ${t} sentences`));
      } catch (err) {
        return void status.setText(err instanceof Error ? err.message : String(err));
      }
      this.count = defaultLength(this.sentences.length);
    }
    if (!body.isConnected || this.kind !== "sentences") return;
    status.remove();
    new Setting(body)
      .setName("Sentences")
      .setDesc(`Of ${this.sentences.length} in the text.`)
      .addSlider((s) =>
        s.setLimits(1, Math.min(this.sentences.length, 30), 1).setValue(this.count).setDynamicTooltip().onChange((v) => {
          this.count = v;
          this.drawList();
        })
      );
    this.out = body.createDiv({ cls: "booker-summary-text" });
    this.actions = body.createDiv();
    this.drawList();
  }

  private chosen(): string[] {
    return pickSentences(this.vectors, this.count).map((i) => this.sentences[i]);
  }

  private drawList() {
    this.out.empty();
    const ul = this.out.createEl("ul");
    for (const s of this.chosen()) ul.createEl("li", { text: s });
    this.drawActions(() => this.chosen().join(" "), () => `> [!summary] Summary\n${this.chosen().map((s) => `> - ${s}`).join("\n")}`);
  }

  // ---------------------------------------------------------------- written by the model

  private drawWritten() {
    const body = this.body;
    const info = this.gen!;
    const chunks = chunkText(this.text, info.chunkWords);
    if (!chunks.length) return void body.createEl("p", { cls: "booker-muted", text: "There is no text to summarise." });
    const calls = planCalls(chunks.length);
    const seconds = estimateSeconds(chunks, info);
    let sentences = 4;
    body.createEl("p", { cls: "booker-muted", text: `${chunks.length} part${chunks.length === 1 ? "" : "s"} to read, ${calls.piece + calls.combine} steps, ${describeDuration(seconds)} on this computer.` });
    new Setting(body).setName("Sentences").setDesc("In the final summary.").addSlider((s) => s.setLimits(1, 8, 1).setValue(sentences).setDynamicTooltip().onChange((v) => (sentences = v)));
    new Setting(body).addButton((b) =>
      b.setButtonText("Write summary").setCta().onClick(() => {
        const run = () => void this.runWritten(info, sentences);
        if (seconds > WARN_AFTER_SECONDS)
          new ConfirmModal(
            this.app,
            "This will take a while",
            `The text has ${chunks.length} parts. Writing the summary is ${calls.piece + calls.combine} steps and will take ${describeDuration(seconds)}. Your computer will be busy meanwhile, and you can cancel at any time. Start?`,
            "Start",
            run
          ).open();
        else run();
      })
    );
    this.out = body.createDiv({ cls: "booker-summary-text" });
    this.actions = body.createDiv();
    if (this.written) this.showWritten();
  }

  private async runWritten(info: GenInfo, sentences: number) {
    const progress = new ProgressModal(this.app, "Writing the summary");
    progress.open();
    progress.update({ step: "Loading the model", done: 0, total: 1 });
    try {
      const gen = await this.plugin.gen.generator(info);
      const text = await summarizeLong(this.text, {
        sentences,
        chunkWords: info.chunkWords,
        write: (prompt, max) => gen.write(prompt, max, () => progress.cancelled),
        onProgress: (p) => progress.update(p),
        cancelled: () => progress.cancelled,
      });
      progress.finish();
      if (!grounded(text, this.text)) return void new Notice("Booker: the model's summary did not match your text, so it is not shown. Very short texts often fail; try Best sentences instead.", 10000);
      this.written = text;
      this.writtenBy = info.label;
      this.showWritten();
    } catch (e) {
      progress.finish();
      if (e instanceof Cancelled) new Notice("Booker: cancelled. Nothing was written.");
      else new Notice(`Booker: could not write the summary. ${e instanceof Error ? e.message : e}`);
    }
  }

  private showWritten() {
    this.out.empty();
    this.out.createEl("p", { text: this.written });
    this.out.createEl("p", { cls: "booker-muted", text: `Written by ${this.writtenBy} from your text. Check it against the text before you rely on it.` });
    this.drawActions(() => this.written, () => `> [!summary] Summary (written by ${this.writtenBy}; check it)\n${this.written.split(/\n+/).map((l) => `> ${l}`).join("\n")}`);
  }

  // ---------------------------------------------------------------- shared

  private drawActions(plain: () => string, callout: () => string) {
    this.actions.empty();
    new Setting(this.actions)
      .addButton((b) => b.setButtonText("Copy").onClick(() => void navigator.clipboard.writeText(plain()).then(() => new Notice("Booker: copied."))))
      .addButton((b) =>
        b.setButtonText("Insert into note").setCta().onClick(() => {
          const view = this.plugin.lastMarkdownView();
          if (!view) return void new Notice("Booker: open a note to write into first.");
          const ed = view.editor;
          const lead = ed.getLine(ed.getCursor().line).slice(0, ed.getCursor().ch).trim() ? "\n\n" : "";
          ed.replaceSelection(`${lead}${callout()}\n`);
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
