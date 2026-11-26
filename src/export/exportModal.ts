import { OPENING_STYLE_LABELS, resolveOpening, type Opening } from "../writing/initials";
import { Modal, Notice, Platform, Setting, TFile, normalizePath } from "obsidian";
import type BookerPlugin from "../main";
import { exportableProjects, gatherProject, gatherSeries } from "./gatherProject";
import { AdvancedExportModal } from "./advancedModal";
import { wordsFor } from "../profiles/words";
import { profileFor, type Project } from "../project/vaultOps";
import { statusesFor } from "../profiles/profile";
import { breakMark, type ExportOptions, type Preset } from "./headings";
import { buildDocx } from "./docx";
import { buildEpub } from "./epub";
import { buildPdf } from "./pdf";
import { slug } from "./model";
import { safeName } from "../text";
import { applyPreset, deletePreset, presetName, presetNames, savePreset } from "./savedPresets";
import { NamePrompt } from "../ui";
import { describeStats, healthStats, HEALTH_GROUPS } from "../project/health";
import { drawGroup, openFinding, scanProjects } from "../views/healthSupport";

export function defaultOptions(plugin: BookerPlugin): ExportOptions {
  const s = plugin.settings;
  return {
    docx: true,
    epub: true,
    pdf: true,
    preset: "manuscript",
    minStatus: s.exportMinStatus,
    lineBreaksAreParagraphs: true,
    smartQuotes: true,
    sceneBreak: s.sceneBreak,
    chapterStyle: "number-title",
    opening: s.opening,
    actTitles: true,
    trimSize: s.trimSize,
    minSceneStatus: "idea",
    ...(plugin.data.exportOptions ?? {}),
  };
}

export class ExportModal extends Modal {
  private opts: ExportOptions;
  private proj: Project | null;
  /** export every book of the project's series as one manuscript */
  private whole = false;
  /** the saved set last loaded, so it can be deleted */
  private picked = "";

  constructor(private plugin: BookerPlugin, proj?: Project, seriesScope?: string | null) {
    super(plugin.app);
    this.opts = defaultOptions(plugin);
    const all = exportableProjects(plugin);
    this.proj = proj ?? all[0] ?? null;
    // the chapter opening follows the project's own format unless an export choice was saved
    if (this.proj && !plugin.data.exportOptions?.opening) this.opts.opening = plugin.effectiveFormat(this.proj.file.path).opening;
    this.whole = !!proj && !!seriesScope && !!proj.series && proj.series.folder === seriesScope;
  }

  onOpen() {
    this.draw();
  }

  private draw() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("booker-export");
    contentEl.createEl("h3", { text: "Export a book" });
    const all = exportableProjects(this.plugin);
    if (!all.length) {
      contentEl.createEl("p", { text: "No projects found. Create a project from the Booker hub first." });
      return;
    }

    new Setting(contentEl).setName("Project").addDropdown((d) => {
      const series = new Map<string, string>();
      for (const p of all) {
        d.addOption(p.file.path, p.name);
        if (p.series) series.set(p.series.folder, p.series.name);
      }
      for (const [folder, name] of series) d.addOption(`series:${folder}`, `All books in ${name} (one manuscript)`);
      d.setValue(this.whole && this.proj?.series ? `series:${this.proj.series.folder}` : this.proj?.file.path ?? all[0].file.path).onChange((v) => {
        this.whole = v.startsWith("series:");
        this.proj = this.whole ? all.find((p) => p.series?.folder === v.slice(7)) ?? null : all.find((p) => p.file.path === v) ?? null;
        this.draw();
      });
    });

    this.savedRow(contentEl);

    new Setting(contentEl)
      .setName("Look")
      .setDesc("Manuscript is for agents and editors: double-spaced with running headers. Book is the reader-facing layout.")
      .addDropdown((d) =>
        d
          .addOptions({ manuscript: "Manuscript (submission)", trade: "Book (print / reading)" })
          .setValue(this.opts.preset)
          .onChange((v) => (this.opts.preset = v as Preset))
      );

    const fmt = new Setting(contentEl).setName("Formats").setDesc("ePub always uses the book layout.");
    for (const [key, label] of [["docx", "Word"], ["epub", "ePub"], ["pdf", "PDF"]] as const) {
      fmt.addToggle((t) => t.setTooltip(label).setValue(this.opts[key]).onChange((v) => (this.opts[key] = v)));
      fmt.controlEl.createSpan({ text: label, cls: "booker-fmt-label" });
    }

    new Setting(contentEl)
      .setName("Include scenes at or above")
      .addDropdown((d) => {
        const list = statusesFor(this.proj?.profile);
        for (const s of list) d.addOption(s, s);
        d.setValue(this.opts.minSceneStatus && list.includes(this.opts.minSceneStatus) ? this.opts.minSceneStatus : list[0]).onChange((v) => (this.opts.minSceneStatus = v));
      });

    new Setting(contentEl)
      .setName("Chapter opening letter")
      .setDesc("A large first letter on each chapter's first paragraph. Separate from the editor's Book styling, so you can turn it off for one export. ePub for now.")
      .addDropdown((d) =>
        d.addOptions(OPENING_STYLE_LABELS).setValue(resolveOpening(this.opts.opening).style).onChange((v) => {
          this.opts.opening = { ...resolveOpening(this.opts.opening), style: v as Opening["style"] };
        })
      );

    new Setting(contentEl)
      .setName("Page size, fonts, spacing and more")
      .setDesc("Margins, line spacing, first-line indent, page breaks, headers and numbering.")
      .addButton((b) => b.setButtonText("Advanced settings…").onClick(() => new AdvancedExportModal(this.plugin.app, this.opts, async () => {
        this.plugin.data.exportOptions = { ...this.opts };
        await this.plugin.persist();
      }, this.proj ? wordsFor(profileFor(this.proj)) : undefined).open()));

    this.healthRow(contentEl);

    const status = contentEl.createDiv({ cls: "booker-muted" });
    status.setText(`Files go to “${this.plugin.exportFolder()}” in your vault.`);

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Export")
        .setCta()
        .onClick(async () => {
          if (!this.proj) return;
          if (!this.opts.docx && !this.opts.epub && !this.opts.pdf) {
            new Notice("Choose at least one format.");
            return;
          }
          b.setDisabled(true).setButtonText("Working…");
          try {
            this.plugin.data.exportOptions = { ...this.opts };
            await this.plugin.persist();
            const files = await runExport(this.plugin, this.proj, this.opts, (msg) => status.setText(msg), this.whole);
            this.close();
            new ExportDone(this.plugin, files).open();
          } catch (e) {
            console.error("Booker export failed", e);
            status.setText(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
            b.setDisabled(false).setButtonText("Export");
          }
        })
    );
  }

  /** A small health button: one line of warning stats, and the warnings themselves when it is opened. */
  private healthRow(contentEl: HTMLElement) {
    const row = new Setting(contentEl).setName("Project health").setDesc("Checking…");
    const list = contentEl.createDiv({ cls: "booker-export-health" });
    list.hide();
    let open = false;
    let scan = 0;
    let findings: ReturnType<typeof healthStats> | null = null;
    let items: Awaited<ReturnType<typeof scanProjects>>["report"]["findings"] = [];
    const draw = () => {
      list.empty();
      if (!open || !findings?.total) return void list.hide();
      list.show();
      for (const g of HEALTH_GROUPS) {
        const group = items.filter((f) => f.group === g);
        if (!group.length) continue;
        drawGroup(this.plugin, list, g, group, (f) => {
          this.close();
          void openFinding(this.plugin, f);
        }, () => void check());
      }
    };
    row.addExtraButton((b) =>
      b.setIcon("stethoscope").setTooltip("Show the warnings").onClick(() => {
        open = !open;
        draw();
      })
    );
    const check = async () => {
      const projects = this.whole && this.proj?.series ? exportableProjects(this.plugin).filter((p) => p.series?.folder === this.proj?.series?.folder) : this.proj ? [this.proj] : [];
      const mine = ++scan;
      try {
        const { report } = await scanProjects(this.plugin, projects);
        if (mine !== scan) return;
        items = report.findings;
        findings = healthStats(items);
        row.setDesc(describeStats(findings));
        draw();
      } catch {
        row.setDesc("Could not check the project.");
      }
    };
    void check();
  }

  /** Pick, save or delete a named set of these settings. */
  private savedRow(contentEl: HTMLElement) {
    const saved = this.plugin.data.exportPresets;
    const names = presetNames(saved);
    const row = new Setting(contentEl).setName("Saved settings").setDesc("Keep a set of export settings under a name, such as one for an agent and one for print.");
    if (names.length) {
      row.addDropdown((d) => {
        d.addOption("", "Choose…");
        for (const n of names) d.addOption(n, n);
        d.setValue(saved?.[this.picked] ? this.picked : "").onChange((v) => {
          this.picked = v;
          if (!v) return;
          this.opts = applyPreset(this.opts, saved?.[v]);
          this.draw();
          new Notice(`Loaded “${v}”.`);
        });
      });
    }
    row.addButton((b) =>
      b.setButtonText("Save as…").onClick(() =>
        new NamePrompt(this.app, "Save export settings", "A name for these settings", (raw) => {
          const name = presetName(raw);
          if (!name) return;
          this.plugin.data.exportPresets = savePreset(this.plugin.data.exportPresets, name, this.opts);
          this.picked = name;
          void this.plugin.persist();
          new Notice(`Saved “${name}”.`);
          this.draw();
        }, "", false, "Save").open()
      )
    );
    if (names.length) {
      row.addExtraButton((b) =>
        b.setIcon("trash").setTooltip("Delete a saved set (choose it first)").onClick(() => {
          const n = this.picked;
          if (!n) return void new Notice("Choose a saved set to delete first.");
          this.plugin.data.exportPresets = deletePreset(this.plugin.data.exportPresets, n);
          this.picked = "";
          void this.plugin.persist();
          this.draw();
        })
      );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export interface ExportedFile {
  file: TFile;
  label: string;
}

export async function runExport(plugin: BookerPlugin, proj: Project, opts: ExportOptions, progress: (msg: string) => void = () => {}, whole = false): Promise<ExportedFile[]> {
  const { app } = plugin;
  progress("Reading your scenes…");
  const g = whole && proj.series ? await gatherSeries(plugin, proj, opts) : await gatherProject(plugin, proj, opts);
  if (g.includedScenes === 0) throw new Error(`No scenes to export. ${g.skippedScenes ? `${g.skippedScenes} scenes are below “${opts.minStatus}”.` : "The book is empty."}`);
  const unknown = g.unknownCitations ?? [];
  if (unknown.length) new Notice(`Booker: ${unknown.length} citation${unknown.length === 1 ? "" : "s"} matched no source and printed as typed (${unknown.slice(0, 5).join(", ")}). Project health in the export panel lists them.`, 10000);
  const m = g.manuscript;
  const base = safeName(m.title) || "Untitled";
  const outDir = normalizePath(`${plugin.exportFolder()}/${base}`);
  await ensureFolder(plugin, outDir);
  const out: ExportedFile[] = [];
  const stamp = opts.preset === "manuscript" ? "manuscript" : "book";

  const write = async (name: string, data: ArrayBuffer, label: string) => {
    const path = normalizePath(`${outDir}/${name}`);
    const existing = app.vault.getFileByPath(path);
    const file = existing ? (await app.vault.modifyBinary(existing, data), existing) : await app.vault.createBinary(path, data);
    out.push({ file, label });
  };

  if (opts.docx) {
    progress("Building Word document…");
    await tick();
    await write(`${base} (${stamp}).docx`, await buildDocx(m, opts, breakMark(opts)), "Word");
  }
  if (opts.epub) {
    progress("Building ePub…");
    await tick();
    await write(`${base}.epub`, await buildEpub(m, { ...opts, preset: "trade" }, breakMark(opts), g.cover), "ePub");
  }
  if (opts.pdf) {
    progress("Laying out PDF pages…");
    await tick();
    await write(`${base} (${stamp}).pdf`, await buildPdf(m, opts, breakMark(opts)), "PDF");
  }
  void slug;
  return out;
}

function tick(): Promise<void> {
  return new Promise((r) => window.setTimeout(r, 20));
}

async function ensureFolder(plugin: BookerPlugin, path: string) {
  const parts = path.split("/");
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!plugin.app.vault.getAbstractFileByPath(cur)) await plugin.app.vault.createFolder(cur);
  }
}

class ExportDone extends Modal {
  constructor(private plugin: BookerPlugin, private files: ExportedFile[]) {
    super(plugin.app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Export finished" });
    contentEl.createEl("p", { text: `Saved in “${this.files[0]?.file.parent?.path ?? ""}”.`, cls: "booker-muted" });
    for (const f of this.files) {
      const row = new Setting(contentEl).setName(f.file.name).setDesc(`${f.label} · ${(f.file.stat.size / 1024).toFixed(0)} KB`);
      if (Platform.isDesktopApp) {
        row.addButton((b) => b.setButtonText("Open").onClick(() => (this.plugin.app as any).openWithDefaultApp?.(f.file.path)));
        row.addButton((b) => b.setButtonText("Show in folder").onClick(() => (this.plugin.app as any).showInFolder?.(f.file.path)));
      }
      row.addButton((b) =>
        b.setButtonText("Share…").onClick(async () => {
          try {
            const data = await this.plugin.app.vault.readBinary(f.file);
            const type = f.file.extension === "pdf" ? "application/pdf" : f.file.extension === "epub" ? "application/epub+zip" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            const file = new File([data], f.file.name, { type });
            if ((navigator as any).canShare?.({ files: [file] })) await (navigator as any).share({ files: [file], title: f.file.name });
            else new Notice("Sharing is not available here. Find the file in your vault folder.");
          } catch (e) {
            if ((e as Error)?.name !== "AbortError") new Notice("Could not open the share sheet.");
          }
        })
      );
    }
    new Setting(contentEl).addButton((b) => b.setButtonText("Done").setCta().onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
}
