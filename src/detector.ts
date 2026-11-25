import { EditorView } from "@codemirror/view";
import { MarkdownView, Notice, TFile } from "obsidian";
import type BookerPlugin from "./main";
import { addToProperties, Ask, detect, Known } from "./project/detect";
import { isScene, linkList } from "./project/format";
import { codexFiles, findProjects, Project, readScenes } from "./project/vaultOps";

/**
 * Replaces auto-linking. Instead of turning names in the text into links, a name that appears in a scene for the first time
 * is added to that scene's properties (characters, location). The text of the scene is never changed.
 */
export class NameDetector {
  private timer: number | null = null;
  /** questions waiting for an answer, by scene path */
  private pending = new Map<string, Ask[]>();
  /** questions answered with "neither" in this session */
  private skipped = new Set<string>();
  private collapsed = false;

  constructor(private plugin: BookerPlugin) {}

  /** CodeMirror listener: after you stop typing for a moment, look at the scene you are in. */
  extension() {
    return EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      if (!u.transactions.some((t) => t.isUserEvent("input") || t.isUserEvent("paste") || t.isUserEvent("delete"))) return;
      if (this.timer !== null) window.clearTimeout(this.timer);
      const view = u.view;
      this.timer = window.setTimeout(() => {
        this.timer = null;
        const mv = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (mv?.file && (mv.editor as any)?.cm === view && this.autoOn(mv.file)) void this.detectFile(mv.file, view.state.doc.toString());
      }, this.plugin.settings.autoLinkIdleMs);
    });
  }

  /** Whether names are added as you write: the book's own choice, else the plugin setting. */
  autoOn(file: TFile): boolean {
    const proj = this.projectOf(file);
    return proj ? proj.detectNames ?? this.plugin.settings.detectNames : false;
  }

  private projectOf(file: TFile): Project | null {
    return findProjects(this.plugin.app).find((p) => file.path.startsWith(p.layout.scenes + "/")) ?? null;
  }

  private known(proj: Project, kind: "characters" | "locations"): Known[] {
    const { metadataCache } = this.plugin.app;
    return codexFiles(this.plugin.app, proj, kind).map((f) => {
      const fm = metadataCache.getFileCache(f)?.frontmatter ?? {};
      const aliases = Array.isArray(fm.aliases) ? fm.aliases : typeof fm.aliases === "string" ? [fm.aliases] : [];
      return { name: String(fm.name ?? f.basename), aliases: aliases.map(String) };
    });
  }

  /** Look for codex names in one scene and add any new ones to its properties. Anything unclear is asked, not guessed. */
  async detectFile(file: TFile, text?: string): Promise<boolean> {
    const { app, settings } = this.plugin;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !isScene(fm)) return false;
    const proj = this.projectOf(file);
    if (!proj) return false;
    const place = linkList(fm.location);
    const found = detect(text ?? (await app.vault.cachedRead(file)), this.known(proj, "characters"), this.known(proj, "locations"), settings.autoLinkMatchCase, {
      characters: [...linkList(fm.characters), ...linkList(fm.pov)],
      locations: place,
    });
    // a scene holds one place, so once it has one there is nothing to add or ask
    if (place.length) found.locations = [];
    const asks = found.ask.filter((a) => !(a.kind === "locations" && place.length) && !this.skipped.has(`${file.path}|${a.text.toLowerCase()}`));
    this.setPending(file, asks);
    if (!found.characters.length && !found.locations.length) return false;
    let changed = false;
    await app.fileManager.processFrontMatter(file, (f) => {
      changed = addToProperties(f, found);
    });
    return changed;
  }

  // -------------------------------------------------------- the question box

  /** Show a scene's open questions again, for example when its tab comes back to the front. */
  repaint(file: TFile) {
    this.paint(file);
  }

  private setPending(file: TFile, asks: Ask[]) {
    if (asks.length) this.pending.set(file.path, asks);
    else this.pending.delete(file.path);
    this.paint(file);
  }

  private paint(file: TFile) {
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!(v instanceof MarkdownView) || v.file?.path !== file.path) return;
      v.contentEl.querySelectorAll(".booker-ask").forEach((e) => e.remove());
      const asks = this.pending.get(file.path);
      if (asks?.length) this.box(v, file, asks);
    });
  }

  /** A small card in the corner of the page. It never takes focus, so you can keep typing; nothing is added until you pick. */
  private box(view: MarkdownView, file: TFile, asks: Ask[]) {
    const ask = asks[0];
    const box = view.contentEl.createDiv({ cls: "booker-ask" + (this.collapsed ? " is-collapsed" : "") });
    box.addEventListener("mousedown", (ev) => ev.preventDefault());
    const head = box.createDiv({ cls: "booker-ask-head" });
    head.createSpan({ cls: "booker-ask-title", text: `Which ${ask.text}?` });
    if (asks.length > 1) head.createSpan({ cls: "booker-muted", text: `1 of ${asks.length}` });
    const fold = head.createEl("button", { cls: "clickable-icon booker-ask-fold", attr: { "aria-label": this.collapsed ? "Show question" : "Hide question for now" } });
    fold.setText(this.collapsed ? "?" : "–");
    fold.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.paint(file);
    });
    if (this.collapsed) return;
    box.createDiv({ cls: "booker-muted booker-ask-hint", text: `Added to this scene's ${ask.kind === "characters" ? "characters" : "location"} once you choose.` });
    const row = box.createDiv({ cls: "booker-ask-options" });
    for (const o of ask.options) {
      const b = row.createEl("button", { cls: "booker-btn mod-cta", text: o });
      b.addEventListener("click", () => void this.answer(file, ask, o));
    }
    const none = row.createEl("button", { cls: "booker-btn", text: "Neither" });
    none.addEventListener("click", () => {
      this.skipped.add(`${file.path}|${ask.text.toLowerCase()}`);
      this.setPending(file, asks.slice(1));
    });
  }

  private async answer(file: TFile, ask: Ask, choice: string) {
    await this.plugin.app.fileManager.processFrontMatter(file, (f) => {
      addToProperties(f, { characters: ask.kind === "characters" ? [choice] : [], locations: ask.kind === "locations" ? [choice] : [] });
    });
    this.setPending(file, (this.pending.get(file.path) ?? []).filter((a) => a !== ask));
  }

  /** Every scene in the project the file or the first project belongs to. */
  async detectProject(proj: Project | null): Promise<number> {
    const project = proj ?? findProjects(this.plugin.app)[0];
    if (!project) return 0;
    let n = 0;
    for (const s of readScenes(this.plugin.app, project)) {
      const f = this.plugin.app.vault.getFileByPath(s.path);
      if (f && (await this.detectFile(f))) n++;
    }
    return n;
  }

  notice(n: number, what: string) {
    new Notice(n ? `Added names to ${n} ${what}${n === 1 ? "" : "s"}.` : `No new names found in ${what}s.`);
  }
}
