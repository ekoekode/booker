import { App, Modal, Setting } from "obsidian";
import { gapYears, type SeqTemplate } from "../project/sequence";

/** How a category behaves as a sequence: items that are numbered, dated and linked in time. */
export interface SequenceOption {
  /** switched on */
  on: boolean;
  /** the category already has sequence settings (so "off" means switched off, and Remove is offered) */
  exists?: boolean;
  /** Lives are always a sequence: the switch is shown but cannot be turned off */
  locked?: boolean;
  sequential: boolean;
  defaultGap: string;
  anchorKinds: SeqTemplate["anchorKinds"];
}

export const DEFAULT_SEQUENCE: SequenceOption = { on: false, sequential: true, defaultGap: "3d", anchorKinds: ["character", "item", "scene", "event"] };

/** A Codex category's options. With `asking` it is a new category (it asks a name); otherwise it edits the options of an existing one. */
export class CodexCategoryModal extends Modal {
  private name = "";
  private done = false;
  private seq: SequenceOption;

  constructor(
    app: App,
    private opts: { heading: string; hint?: string; asking: boolean; alias: boolean; sequence?: SequenceOption },
    private onDone: (name: string, alias: boolean, sequence?: SequenceOption) => void,
    private onRemove?: () => void,
  ) {
    super(app);
    this.seq = opts.sequence ? { ...opts.sequence, anchorKinds: [...opts.sequence.anchorKinds] } : { ...DEFAULT_SEQUENCE, anchorKinds: [...DEFAULT_SEQUENCE.anchorKinds] };
  }

  onOpen() {
    const { contentEl, opts, seq } = this;
    contentEl.addClass("booker-cat-modal");
    contentEl.createEl("h3", { text: opts.heading });
    if (opts.hint) contentEl.createEl("p", { text: opts.hint, cls: "booker-muted" });
    let input: HTMLInputElement | null = null;
    if (opts.asking) {
      input = contentEl.createEl("input", { type: "text", cls: "booker-input" });
      input.placeholder = "Name";
      input.addEventListener("input", () => (this.name = input!.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
    }
    new Setting(contentEl)
      .setName("Auto-suggest for aliases")
      .setDesc("Offer the real name when an alias is written, and warn when two notes share one.")
      .addToggle((t) => t.setValue(opts.alias).onChange((v) => (opts.alias = v)));

    // sequence settings: any category can become a linked, dated, optionally numbered sequence
    const box = contentEl.createDiv({ cls: "booker-seq-box" + (seq.on ? " is-on" : " is-off") });
    const head = box.createDiv({ cls: "booker-seq-head" });
    head.createSpan({ cls: "booker-seq-title", text: "Sequence" });
    const state = head.createSpan({ cls: "booker-seq-state" });
    const err = box.createEl("p", { cls: "booker-warn booker-seq-err" });
    let body!: HTMLElement;
    const refresh = () => {
      box.toggleClass("is-on", seq.on);
      box.toggleClass("is-off", !seq.on);
      state.setText(seq.locked ? "Always on" : seq.on ? "On" : seq.exists ? "Off, settings kept" : "Off");
      body?.toggle(seq.on);
    };
    new Setting(box)
      .setName(seq.exists || seq.locked ? "Enabled" : "Make this category a sequence")
      .setDesc(seq.locked ? "Lives are always a sequence." : seq.exists ? "Off keeps these settings and every date and link, but nothing follows, repairs or is checked until you turn it back on." : "Its items get dates, can follow each other or any note in time, and show on the timeline.")
      .addToggle((t) => {
        t.setValue(seq.on).onChange((v) => {
          seq.on = v;
          refresh();
        });
        if (seq.locked) t.setDisabled(true);
      });
    // the options sit under the switch that turns them on
    body = box.createDiv({ cls: "booker-seq-body" });
    new Setting(body).setName("Numbered, each follows the last").setDesc("Items are numbered in order and each starts a gap after the one before. Off: free-standing items you date or anchor yourself.").addToggle((t) => t.setValue(seq.sequential).onChange((v) => (seq.sequential = v)));
    new Setting(body).setName("Default gap").setDesc("From one item's end to the next one's start: 3d, 2w, 1m or 1y. Each item can set its own.").addText((t) => t.setValue(seq.defaultGap).onChange((v) => (seq.defaultGap = v.trim())));
    body.createDiv({ cls: "booker-seq-sub", text: "Items can be anchored to" });
    const kinds: Array<[SeqTemplate["anchorKinds"][number], string]> = [["item", "Another item"], ["character", "A character"], ["scene", "A scene"], ["event", "An event"]];
    const chips = body.createDiv({ cls: "booker-seq-chips" });
    for (const [k, label] of kinds) {
      const chip = chips.createEl("button", { cls: "booker-seq-chip", text: label });
      const paint = () => chip.toggleClass("is-on", seq.anchorKinds.includes(k));
      paint();
      chip.addEventListener("click", () => {
        seq.anchorKinds = seq.anchorKinds.includes(k) ? seq.anchorKinds.filter((a) => a !== k) : [...seq.anchorKinds, k];
        paint();
      });
    }
    refresh();

    const actions = new Setting(contentEl);
    if (this.onRemove && seq.exists && !seq.locked)
      actions.addButton((b) =>
        b.setButtonText("Remove sequence").setWarning().setTooltip("Takes the sequence settings and marks off this category. Dates and links stay in the notes.").onClick(() => {
          this.done = true;
          this.close();
          this.onRemove!();
        }),
      );
    actions.addButton((b) =>
      b.setButtonText(opts.asking ? "Create" : "Save").setCta().onClick(() => {
        if (seq.on && gapYears(seq.defaultGap) === null) return void err.setText("That gap is not readable. Use a number and d, w, m or y, such as 3d.");
        this.submit();
      }),
    );
    if (input) window.setTimeout(() => input!.focus(), 30);
  }

  private submit() {
    const v = this.name.trim();
    if (this.opts.asking && !v) return;
    if (this.done) return;
    this.done = true;
    this.close();
    this.onDone(v, this.opts.alias, this.seq);
  }

  onClose() {
    this.contentEl.empty();
  }
}
