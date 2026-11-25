import { App, Modal, Setting } from "obsidian";
import { gapYears, type AnchorEdge, type AnchorMode, type NewItemOptions, type SeqTemplate } from "../project/sequence";

export interface ItemChoice extends NewItemOptions {
  group: string;
  label: string;
  inSequence: boolean;
}

/**
 * New item from a sequence template (a Life, an Era…): everything about how it sits in time, in one box. Its name, whose
 * sequence it joins, whether it is in the sequence at all, its own gap, and what it is anchored to and how.
 */
export class SequenceItemModal extends Modal {
  private v: ItemChoice;
  private done = false;

  constructor(app: App, private tpl: SeqTemplate, init: { group?: string; groupFixed?: boolean; inSequence?: boolean }, private notes: string[], private groups: string[], private onSubmit: (c: ItemChoice) => void) {
    super(app);
    this.v = { group: init.group ?? "", label: "", inSequence: init.inSequence ?? tpl.sequential, gap: "", anchor: "", anchorMode: "after", anchorEdge: "end" };
    this.groupFixed = !!init.groupFixed;
  }
  private groupFixed: boolean;

  onOpen() {
    const { contentEl, tpl, v } = this;
    contentEl.createEl("h3", { text: `New ${tpl.label.toLowerCase()}` });
    contentEl.createEl("p", { cls: "booker-muted", text: `${tpl.label} default gap is ${tpl.defaultGap}. Leave a setting empty to use it.` });
    const err = contentEl.createEl("p", { cls: "booker-muted" });

    new Setting(contentEl).setName("Name").setDesc("Leave empty to number it.").addText((t) => t.setPlaceholder(`${tpl.label} name`).onChange((x) => (v.label = x)));
    if (!this.groupFixed) {
      const list = contentEl.createEl("datalist");
      list.id = "booker-seq-groups";
      for (const g of this.groups) list.createEl("option", { value: g });
      new Setting(contentEl).setName("Belongs to").setDesc("Whose sequence this joins, such as a character. Empty = one shared sequence.").addText((t) => {
        t.setValue(v.group).onChange((x) => (v.group = x.trim()));
        t.inputEl.setAttr("list", "booker-seq-groups");
      });
    }
    const seqOnly: HTMLElement[] = [];
    const anchorRows: HTMLElement[] = [];
    const show = () => {
      for (const e of seqOnly) e.toggle(tpl.sequential);
      for (const e of anchorRows) e.toggle(!!v.anchor);
    };
    if (tpl.sequential) {
      const s = new Setting(contentEl).setName("In the sequence").setDesc("On: numbered after the last one and starting a gap after it ends. Off: free-standing, no number or dates yet.").addToggle((t) => t.setValue(v.inSequence).onChange((x) => (v.inSequence = x)));
      seqOnly.push(s.settingEl);
    }
    new Setting(contentEl).setName("Gap").setDesc(`Time before it starts, such as 3d, 2w, 1m or 1y. Empty = ${tpl.defaultGap}.`).addText((t) => t.setPlaceholder(tpl.defaultGap).onChange((x) => (v.gap = x.trim())));

    const list = contentEl.createEl("datalist");
    list.id = "booker-seq-notes";
    for (const n of this.notes.slice(0, 800)) list.createEl("option", { value: n });
    new Setting(contentEl).setName("Anchored to").setDesc("A note whose dates this follows: another item, a character, a scene or an event. Empty = follows the previous one in the sequence.").addText((t) => {
      t.setPlaceholder("note name").onChange((x) => {
        v.anchor = x.trim();
        show();
      });
      t.inputEl.setAttr("list", "booker-seq-notes");
    });
    anchorRows.push(
      new Setting(contentEl).setName("Relation").addDropdown((d) => d.addOptions({ after: "After it", with: "At the same time as it", before: "Before it" }).setValue(v.anchorMode ?? "after").onChange((x) => (v.anchorMode = x as AnchorMode))).settingEl,
      new Setting(contentEl).setName("Of its").addDropdown((d) => d.addOptions({ end: "End", start: "Start" }).setValue(v.anchorEdge ?? "end").onChange((x) => (v.anchorEdge = x as AnchorEdge))).settingEl,
    );
    show();

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Create").setCta().onClick(() => {
        if (v.gap && gapYears(v.gap) === null) return void err.setText("That gap is not readable. Use a number and d, w, m or y, such as 3d.");
        if (this.done) return;
        this.done = true;
        this.close();
        this.onSubmit({ ...v, gap: v.gap || undefined, anchor: v.anchor || undefined, anchorMode: v.anchor ? v.anchorMode : undefined, anchorEdge: v.anchor ? v.anchorEdge : undefined });
      }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** A sequence template's settings: its name (new ones only), default gap, whether it is sequential, and what it can be anchored to. */
export class SequenceTemplateModal extends Modal {
  private t: SeqTemplate;
  private done = false;

  constructor(app: App, init: SeqTemplate | null, private existing: string[], private onSubmit: (t: SeqTemplate) => void) {
    super(app);
    this.t = init ? { ...init, anchorKinds: [...init.anchorKinds] } : { id: "", label: "", folder: "", type: "", sequential: true, defaultGap: "3d", anchorKinds: ["character", "item", "scene", "event"] };
    this.isNew = !init;
  }
  private isNew: boolean;

  onOpen() {
    const { contentEl, t } = this;
    contentEl.createEl("h3", { text: this.isNew ? "New sequence template" : `${t.label} settings` });
    contentEl.createEl("p", { cls: "booker-muted", text: this.isNew ? "A kind of timeline item that can follow others, like Lives: an Era, a Job, a Residence. It becomes a Codex folder." : "Changes apply to items made from now on; run Repair sequences to apply a new gap to the ones you have." });
    const err = contentEl.createEl("p", { cls: "booker-muted" });
    if (this.isNew) new Setting(contentEl).setName("Name").addText((x) => x.setPlaceholder("e.g. Era").onChange((v) => (t.label = v.trim())));
    new Setting(contentEl).setName("Default gap").setDesc("Time from one item's end to the next one's start: 3d, 2w, 1m or 1y. Each item can set its own.").addText((x) => x.setValue(t.defaultGap).onChange((v) => (t.defaultGap = v.trim())));
    new Setting(contentEl).setName("Sequential").setDesc("Items are numbered and each follows the one before. Off: free-standing items you date yourself.").addToggle((x) => x.setValue(t.sequential).onChange((v) => (t.sequential = v)));
    contentEl.createEl("h4", { text: "Can be anchored to" });
    const kinds: Array<[SeqTemplate["anchorKinds"][number], string]> = [["item", "Another item"], ["character", "A character"], ["scene", "A scene"], ["event", "An event"]];
    for (const [k, label] of kinds) new Setting(contentEl).setName(label).addToggle((x) => x.setValue(t.anchorKinds.includes(k)).onChange((v) => (t.anchorKinds = v ? [...new Set([...t.anchorKinds, k])] : t.anchorKinds.filter((a) => a !== k))));
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(this.isNew ? "Create" : "Save").setCta().onClick(() => {
        if (gapYears(t.defaultGap) === null) return void err.setText("That gap is not readable. Use a number and d, w, m or y, such as 3d.");
        if (this.isNew) {
          if (!t.label) return void err.setText("Give the template a name.");
          const id = t.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          if (!id) return void err.setText("That name is not allowed.");
          if (this.existing.includes(id)) return void err.setText(`A template called ${t.label} already exists.`);
          t.id = id;
          t.type = id;
          t.folder = t.label;
        }
        if (this.done) return;
        this.done = true;
        this.close();
        this.onSubmit({ ...t, defaultGap: t.defaultGap });
      }),
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
