import { wordsFor } from "../profiles/words";
import { App, Modal, Notice, Setting, TFolder } from "obsidian";
import { adoptFolder, copyFolderAsProject, detectLooseProjects, findProjects, profileFor, Project } from "../project/vaultOps";
import { FolderPicker, notifyError } from "../ui";
import { ImportMarkdownModal } from "./importMarkdownModal";
import type BookerPlugin from "../main";

/** One place to bring writing in: an existing StoryLine folder, or chapters and sections from a Markdown file. */
export class ImportModal extends Modal {
  constructor(app: App, private plugin: BookerPlugin, private proj: Project | null, private openProject: (p: Project) => void, private refresh: () => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Import" });

    contentEl.createEl("h4", { text: "A StoryLine folder" });
    contentEl.createEl("p", { cls: "booker-muted", text: "Projects already in your vault are listed in the hub. Folders that have scenes but no project note yet show up here. Copy keeps the original folder exactly as it is and works on a copy; Add in place only creates the project note and any missing folders, and changes none of your notes." });
    const loose = detectLooseProjects(this.app);
    if (!loose.length) contentEl.createEl("p", { cls: "booker-muted", text: "No unlisted StoryLine folders were found." });
    for (const path of loose) new Setting(contentEl).setName(path.split("/").pop() ?? path).setDesc(path).addButton((b) => b.setButtonText("Copy as project").setCta().onClick(() => this.copy(path))).addButton((b) => b.setButtonText("Add in place").onClick(() => this.adopt(path)));
    new Setting(contentEl)
      .setName("Choose a folder")
      .setDesc("Pick any folder in the vault that holds a StoryLine project.")
      .addButton((b) => b.setButtonText("Choose…").onClick(() => this.choose()));

    contentEl.createEl("h4", { text: "Chapters and sections from a file" });
    const target = this.proj ? `into “${this.proj.name}”` : "into the selected project";
    new Setting(contentEl)
      .setName("Import a manuscript file")
      .setDesc(`Markdown, Word, OpenDocument or ePub. ${this.proj ? ((w) => `Headings become ${w.hasMid ? w.midMany.toLowerCase() : w.itemMany.toLowerCase()}${w.hasTop ? `, Part or ${w.top} headings become ${w.topMany.toLowerCase()}` : ""}, and breaks (***) split the text into ${w.itemMany.toLowerCase()}, numbered ${w.item} 1, 2… through the book.`)(wordsFor(profileFor(this.proj))) : "Headings and breaks split it into the sections of the book you choose."} Added ${target}.`)
      .addButton((b) =>
        b.setButtonText("Import file…").setDisabled(!this.proj).onClick(() => {
          this.close();
          new ImportMarkdownModal(this.app, this.proj!, this.plugin, this.refresh).open();
        })
      );
    new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
  }

  private choose() {
    const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !!f.path && !f.path.startsWith("."));
    new FolderPicker(this.app, folders, "Which folder holds the project?", (f) => void this.copy(f.path)).open();
  }

  private async copy(path: string) {
    try {
      const { project, report } = await copyFolderAsProject(this.app, path);
      const note = `Booker: copied ${report.files} files (${report.scenes} scenes, ${report.codex} world notes, ${report.other} other) to “${report.to}”. The original is unchanged.${report.other ? " Notes outside Scenes and Codex (for example a Characters folder) were copied but are not in the Codex; move them into Codex/Characters or Codex/Locations." : ""}`;
      new Notice(report.skipped.length ? `${note} ${report.skipped.length} could not be copied: ${report.skipped.slice(0, 3).join(", ")}${report.skipped.length > 3 ? "…" : ""}` : note, 12000);
      this.close();
      this.openProject(project);
    } catch (e) {
      notifyError(e, "copy the project");
    }
  }

  private async adopt(path: string) {
    try {
      const known = findProjects(this.app).find((p) => p.layout.base === path);
      const proj = known ?? (await adoptFolder(this.app, path));
      new Notice(known ? `Booker: “${proj.name}” is already a project; showing it.` : `Booker: added “${proj.name}” as a project.`);
      this.close();
      this.openProject(proj);
    } catch (e) {
      notifyError(e, "add the project");
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
