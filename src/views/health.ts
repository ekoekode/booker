import { ItemView, Notice, WorkspaceLeaf, debounce } from "obsidian";
import type BookerPlugin from "../main";
import { HEALTH_GROUPS } from "../project/health";
import { findProjects } from "../project/vaultOps";
import { actionBtn, actionRow } from "../ui";
import { VIEW_CHECKS } from "./checks";
import { drawGroup, openFinding, rebuildProject, scanProjects } from "./healthSupport";
import { drawFormatBanner } from "./formatFix";

export const VIEW_HEALTH = "booker-health";

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

/** Project health: one list of what needs attention: citations, footnotes, scripture references, scene file info that no longer matches the text, and scenes still unwritten. */
export class HealthView extends ItemView {
  private refresh = debounce(() => void this.render(), 1200, true);
  private projectPath: string | null = null;
  private rendering = false;

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }
  getViewType() {
    return VIEW_HEALTH;
  }
  getDisplayText() {
    return "Project health";
  }
  getIcon() {
    return "stethoscope";
  }
  getState() {
    return { project: this.projectPath };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    await super.setState(state, result);
    await this.render();
  }

  async onOpen() {
    this.contentEl.addClass("booker-checks");
    const { vault, metadataCache } = this.plugin.app;
    this.registerEvent(metadataCache.on("changed", () => this.refresh()));
    this.registerEvent(vault.on("delete", () => this.refresh()));
    await this.render();
  }

  async render() {
    if (this.rendering) return;
    this.rendering = true;
    try {
      const root = this.contentEl;
      const all = findProjects(this.plugin.app);
      const proj = all.find((p) => p.file.path === this.projectPath) ?? all[0];
      const scan = proj ? await scanProjects(this.plugin, [proj]) : null;
      root.empty();
      if (!proj || !scan) return void el(root, "p", "booker-muted", "No project yet. Create one from the Booker hub.");
      const { report, checkedAgainstBible, dismissed } = scan;
      const head = el(root, "div", "booker-board-head");
      el(head, "h3", undefined, `${proj.name} · Project health`);
      if (all.length > 1) {
        const sel = el(head, "select", "dropdown");
        for (const p of all) {
          const o = el(sel, "option", undefined, p.name);
          o.value = p.file.path;
          o.selected = p.file.path === proj.file.path;
        }
        sel.onchange = () => {
          this.projectPath = sel.value;
          void this.render();
        };
      }
      drawFormatBanner(root, this.plugin, proj, () => void this.render());
      const c = report.counts;
      el(root, "p", "booker-muted", `${c.verses} scripture reference${c.verses === 1 ? "" : "s"}, ${c.citations} citation${c.citations === 1 ? "" : "s"}, ${c.notes} footnote${c.notes === 1 ? "" : "s"}, ${c.sources} source${c.sources === 1 ? "" : "s"}.${checkedAgainstBible ? "" : " No Bible module was found, so scripture references are not checked against one."}`);
      if (!report.findings.length) el(el(root, "section", "booker-checks-sec"), "p", undefined, "Nothing to fix. Citations, footnotes, scripture references, scene file info and scene status all check out.");
      for (const g of HEALTH_GROUPS) {
        const list = report.findings.filter((f) => f.group === g);
        if (!list.length) continue;
        const sec = el(root, "section", "booker-checks-sec");
        drawGroup(this.plugin, sec, g, list, (f) => void openFinding(this.plugin, f, this.leaf), () => void this.render());
      }
      if (dismissed.length) {
        const sec = el(root, "details", "booker-checks-sec");
        el(sec, "summary", "booker-muted", `Dismissed (${dismissed.length})`);
        for (const g of HEALTH_GROUPS) {
          const list = dismissed.filter((f) => f.group === g);
          if (list.length) drawGroup(this.plugin, sec, g, list, (f) => void openFinding(this.plugin, f, this.leaf), () => void this.render(), true);
        }
      }
      const acts = actionRow(root);
      actionBtn(acts, "Rebuild", "refresh-cw", () => {
        void rebuildProject(this.plugin, proj)
          .then((m) => new Notice(`Booker: ${m}`, 8000))
          .catch((e) => new Notice(`Booker: could not rebuild. ${e instanceof Error ? e.message : e}`))
          .finally(() => void this.render());
      }, { tip: "Rebuild word counts, links, structure, numbering and the names listed on each scene from the files" });
      actionBtn(acts, "Story checks", "list-checks", () => void this.plugin.openView(VIEW_CHECKS, { project: proj.file.path }), { tip: "Beats, setup and payoff, and continuity" });
      actionBtn(acts, "Check again", "refresh-cw", () => void this.render(), { tip: "Read the book again" });
    } catch (e) {
      new Notice(`Booker: could not check the project. ${e instanceof Error ? e.message : e}`);
    } finally {
      this.rendering = false;
    }
  }
}
