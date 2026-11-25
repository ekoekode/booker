import { App, FuzzySuggestModal, Modal, Notice, Setting, TFolder, setIcon } from "obsidian";

/**
 * A group of buttons that stays together: full size with labels while there is room, wraps onto a second line when it
 * runs out, and shows icons only when even that is too narrow. Put buttons in it with `actionBtn`.
 */
export function actionRow(parent: HTMLElement, cls = ""): HTMLElement {
  return parent.createDiv({ cls: `booker-actions ${cls}`.trim() });
}

export function actionBtn(row: HTMLElement, label: string, icon: string, onClick: (ev: MouseEvent) => void, opts: { cta?: boolean; tip?: string } = {}): HTMLButtonElement {
  const b = row.createEl("button", { cls: "booker-btn" + (opts.cta ? " mod-cta" : "") });
  setIcon(b.createSpan({ cls: "booker-hub-ico booker-btn-icon" }), icon);
  b.createSpan({ cls: "booker-btn-label", text: label });
  b.setAttr("aria-label", opts.tip ?? label.replace(/^\+\s*/, "New "));
  b.addEventListener("click", onClick);
  return b;
}

export class NamePrompt extends Modal {
  private value = "";
  private done = false;
  constructor(app: App, private heading: string, private hint: string, private onSubmit: (name: string) => void, private initial = "", private allowEmpty = false, private button = "Create") {
    super(app);
    this.value = initial;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.heading });
    if (this.hint) contentEl.createEl("p", { text: this.hint, cls: "booker-muted" });
    const input = contentEl.createEl("input", { type: "text", cls: "booker-input" });
    input.placeholder = "Name";
    input.value = this.initial;
    input.addEventListener("input", () => (this.value = input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
    new Setting(contentEl).addButton((b) => b.setButtonText(this.button).setCta().onClick(() => this.submit()));
    window.setTimeout(() => input.focus(), 30);
  }
  private submit() {
    const v = this.value.trim();
    if ((!v && !this.allowEmpty) || this.done) return;
    this.done = true;
    this.close();
    this.onSubmit(v);
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private folders: TFolder[], placeholder: string, private onChoose: (f: TFolder) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): TFolder[] {
    return this.folders;
  }
  getItemText(f: TFolder): string {
    return f.path;
  }
  onChooseItem(f: TFolder): void {
    this.onChoose(f);
  }
}

export interface Choice<T> {
  label: string;
  value: T;
}

export class ChoicePicker<T> extends FuzzySuggestModal<Choice<T>> {
  constructor(app: App, private choices: Choice<T>[], placeholder: string, private onChoose: (v: T) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): Choice<T>[] {
    return this.choices;
  }
  getItemText(c: Choice<T>): string {
    return c.label;
  }
  onChooseItem(c: Choice<T>): void {
    this.onChoose(c.value);
  }
}

export class ConfirmModal extends Modal {
  constructor(app: App, private heading: string, private body: string, private cta: string, private onYes: () => void) {
    super(app);
  }
  onOpen() {
    this.contentEl.createEl("h3", { text: this.heading });
    this.contentEl.createEl("p", { text: this.body }).style.whiteSpace = "pre-line";
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.cta)
          .setCta()
          .onClick(() => {
            this.close();
            this.onYes();
          })
      );
  }
  onClose() {
    this.contentEl.empty();
  }
}

export function notifyError(e: unknown, what: string) {
  console.error(`Booker: ${what}`, e);
  new Notice(`Booker: could not ${what}. ${e instanceof Error ? e.message : String(e)}`);
}

/** A search-as-you-type list of anything with a label. */
export class ListPicker<T> extends FuzzySuggestModal<T> {
  constructor(app: App, private items: T[], private text: (t: T) => string, placeholder: string, private onChoose: (t: T) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): T[] {
    return this.items;
  }
  getItemText(t: T): string {
    return this.text(t);
  }
  onChooseItem(t: T): void {
    this.onChoose(t);
  }
}

const groupOpen = new Map<string, boolean>();

/**
 * A titled, collapsible group for settings rows. Put rows in the returned body with `new Setting(body)`.
 * Open or closed is remembered while Obsidian runs, keyed by `key`.
 */
export function settingsGroup(parent: HTMLElement, key: string, title: string, open = false, hint?: string): HTMLElement {
  const d = parent.createEl("details", { cls: "booker-set-group" });
  d.open = groupOpen.get(key) ?? open;
  d.addEventListener("toggle", () => groupOpen.set(key, d.open));
  const sum = d.createEl("summary");
  sum.createSpan({ cls: "booker-set-group-title", text: title });
  if (hint) sum.createSpan({ cls: "booker-set-group-hint", text: hint });
  return d.createDiv({ cls: "booker-set-group-body" });
}
