import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { IndexModal } from "./views/indexModal";
import { runSelfTest } from "./semantic/selftest";
import type BookerPlugin from "./main";
import { STATUSES, Status } from "./types";
import { OPEN_IN_LABELS, OpenIn, VIEWS_IN_LABELS, ViewsIn } from "./openTarget";
import { DEFAULT_FOLDER } from "./scripture/store";
import { ENGLISH_RESOURCES, MODEL_RESOURCES } from "./resources/catalog";
import { ResourceManager } from "./views/resourceManager";
import { settingsGroup } from "./ui";
import { OPENING_FRAME_LABELS, OPENING_STYLE_LABELS, isFontStyle, resolveOpening, type Opening } from "./writing/initials";
import { formatSize, totalSize } from "./resources/types";

export class BookerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BookerPlugin) {
    super(app, plugin);
  }

  private target!: HTMLElement;

  display(): void {
    this.renderInto(this.containerEl);
  }

  /** Draw every setting into any element: Obsidian's settings page and the project settings window share this, and both edit the same stored settings. */
  renderInto(containerEl: HTMLElement): void {
    this.target = containerEl;
    const s = this.plugin.settings;
    containerEl.empty();
    const general = settingsGroup(containerEl, "set-general", "General", true);
    const updates = settingsGroup(containerEl, "set-updates", "Updates", false, "check for a newer Booker");
    const writing = settingsGroup(containerEl, "set-writing", "Writing format", false, "indents, spacing, font, formatting bar");
    const detect = settingsGroup(containerEl, "set-detect", "Character and place detection", false);
    const opening = settingsGroup(containerEl, "set-opening", "Chapter opening", false, "large first letter");
    const aids = settingsGroup(containerEl, "set-aids", "Goals and editing", false, "word goal, hidden marks");
    const timeline = settingsGroup(containerEl, "set-timeline", "Timeline", false);
    const maps = settingsGroup(containerEl, "set-maps", "Maps", false, "real world, drawn maps, grids");
    const bible = settingsGroup(containerEl, "set-bible", "Bible and reading", false);
    const search = settingsGroup(containerEl, "set-search", "Search by meaning", false, "models and indexes");
    const dict = settingsGroup(containerEl, "set-dictionary", "Dictionary and thesaurus", false);
    const exp = settingsGroup(containerEl, "set-export", "Export", false);

    let updateNote: HTMLElement;
    new Setting(updates)
      .setName(`Booker ${this.plugin.manifest.version}`)
      .setDesc("Looks for a newer version on GitHub and installs it over this one. Your books, Bibles, libraries, downloaded models and settings are not touched.")
      .addButton((b) => b.setButtonText("Check for updates").setCta().onClick(() => void this.plugin.updater.checkAndOffer((t) => updateNote.setText(t))));
    updateNote = updates.createDiv({ cls: "booker-muted" });
    new Setting(updates)
      .setName("Check automatically once a day")
      .setDesc("When Obsidian starts, Booker looks for a newer version and asks before installing anything.")
      .addToggle((t) =>
        t.setValue(s.updateCheck === "on").onChange(async (v) => {
          s.updateCheck = v ? "on" : "off";
          await this.plugin.persist();
        })
      );
    new Setting(general)
      .setName("Open chapters in")
      .setDesc("Which pane a chapter or scene opens in.")
      .addDropdown((d) =>
        d
          .addOptions(OPEN_IN_LABELS)
          .setValue(s.openChaptersIn)
          .onChange(async (v) => {
            s.openChaptersIn = v as OpenIn;
            await this.plugin.persist();
          })
      );
    new Setting(general)
      .setName("Open charts and views in")
      .setDesc("Which pane Board, Plotlines, Timeline and the other pages open in.")
      .addDropdown((d) =>
        d
          .addOptions(VIEWS_IN_LABELS)
          .setValue(s.openViewsIn)
          .onChange(async (v) => {
            s.openViewsIn = v as ViewsIn;
            await this.plugin.persist();
          })
      );
    new Setting(general)
      .setName("Wide window from")
      .setDesc("Writing-area width in pixels from which Auto splits the window.")
      .addText((t) =>
        t.setValue(String(s.wideAt)).onChange(async (v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 300) return;
          s.wideAt = Math.round(n);
          await this.plugin.persist();
        })
      );
    new Setting(general)
      .setName("Folder for new projects")
      .setDesc("Where new projects are made. Existing ones elsewhere are still found.")
      .addText((t) =>
        t.setPlaceholder("Booker").setValue(s.projectRoot).onChange(async (v) => {
          s.projectRoot = v.trim().replace(/^\/+|\/+$/g, "") || "Booker";
          await this.plugin.persist();
        })
      );
    new Setting(general)
      .setName("Your own book templates")
      .setDesc("Define your own kinds of book: levels, statuses, tools and more.")
      .addButton((b) => b.setButtonText("Open templates file").onClick(() => void this.plugin.openProfilesFile()));
    new Setting(general)
      .setName("Show every tool in the ribbon")
      .setDesc("Off shows only the tools that fit the current book. All stay in the command palette.")
      .addToggle((t) =>
        t.setValue(s.showAllTools).onChange(async (v) => {
          s.showAllTools = v;
          await this.plugin.persist();
          this.plugin.applyTools();
        })
      );
    const w = () => this.plugin.writing();
    const setW = async (patch: Partial<ReturnType<typeof w>>) => {
      s.writing = { ...w(), ...patch };
      await this.plugin.persist();
      this.plugin.applyWriting();
    };
    const num = (name: string, desc: string, key: "indent" | "paragraphGap" | "dialogueGap", step: number, max: number) =>
      new Setting(writing)
        .setName(name)
        .setDesc(desc)
        .addSlider((sl) => sl.setLimits(0, max, step).setValue(w()[key]).setDynamicTooltip().onChange((v) => void setW({ [key]: v })));
    new Setting(writing)
      .setName("Typeset scenes while writing")
      .setDesc("Indents and spacing show in the editor only; your text is unchanged.")
      .addToggle((t) => t.setValue(w().on).onChange((v) => void setW({ on: v })));
    new Setting(writing)
      .setName("Book styling")
      .setDesc("Typeset paragraph indents and the large first letter of each chapter in the editor. Off sets paragraphs flush left, with no large letter. Also in a note's ⋯ menu.")
      .addToggle((t) => t.setValue(w().autoIndent).onChange((v) => void setW({ autoIndent: v })));
    num("First-line indent", "In em. 0 turns it off.", "indent", 0.25, 4);
    num("Paragraph spacing", "Extra space before each paragraph, in em.", "paragraphGap", 0.1, 2);
    num("Dialogue spacing", "Extra space before dialogue lines, in em.", "dialogueGap", 0.1, 2);
    new Setting(writing)
      .setName("Indent after headings and scene breaks")
      .setDesc("Off follows book convention: the first paragraph of a scene is not indented.")
      .addToggle((t) => t.setValue(w().indentFirst).onChange((v) => void setW({ indentFirst: v })));
    new Setting(writing)
      .setName("Write in the book's font")
      .setDesc("Show paragraphs in Literata, the font exported books use.")
      .addToggle((t) => t.setValue(w().bookFont).onChange((v) => void setW({ bookFont: v })));
    new Setting(writing)
      .setName("Formatting bar")
      .setDesc("Bold, italic, headings, quote and scene break buttons above the editor.")
      .addToggle((t) => t.setValue(w().bar).onChange((v) => void setW({ bar: v })));
    new Setting(writing)
      .setName("Tab indents a paragraph")
      .setDesc("Tab at a line start adds an em space; Shift+Tab removes it.")
      .addToggle((t) => t.setValue(w().tabIndent).onChange((v) => void setW({ tabIndent: v })));

    const op = () => resolveOpening(s.opening);
    const setOp = async (patch: Partial<Opening>) => {
      s.opening = { ...op(), ...patch };
      await this.plugin.persist();
      this.plugin.applyWriting();
      this.renderInto(this.target);
    };
    new Setting(opening)
      .setName("First letter")
      .setDesc("A large first letter on the first paragraph of each chapter, in the editor and in exported ePub books. The text wraps beside it and underneath.")
      .addDropdown((d) => d.addOptions(OPENING_STYLE_LABELS).setValue(op().style).onChange((v) => void setOp({ style: v as Opening["style"] })));
    if (isFontStyle(op().style))
      new Setting(opening)
        .setName("Frame")
        .setDesc("Drawn around the letter in the text colour.")
        .addDropdown((d) => d.addOptions(OPENING_FRAME_LABELS).setValue(op().frame).onChange((v) => void setOp({ frame: v as Opening["frame"] })));
    if (op().style !== "off")
      new Setting(opening)
        .setName("Height")
        .setDesc("How many lines of text the letter is as tall as.")
        .addDropdown((d) => d.addOptions({ "2": "2 lines", "3": "3 lines", "4": "4 lines" }).setValue(String(op().lines)).onChange((v) => void setOp({ lines: Number(v) as Opening["lines"] })));

    new Setting(detect)
      .setName("Add names to scene properties (default for projects)")
      .setDesc("Add characters and places from your world notes to a scene's properties. Your text is never changed.")
      .addToggle((t) =>
        t.setValue(s.detectNames).onChange(async (v) => {
          s.detectNames = v;
          await this.plugin.persist();
        })
      );

    new Setting(detect)
      .setName("Match capitalisation")
      .setDesc("Ignore counts 'MARA' for 'Mara'; Respect needs the exact case.")
      .addDropdown((d) =>
        d
          .addOptions({ ignore: "Ignore", respect: "Respect" })
          .setValue(s.autoLinkMatchCase)
          .onChange(async (v) => {
            s.autoLinkMatchCase = v as "ignore" | "respect";
            await this.plugin.persist();
          })
      );

    new Setting(detect)
      .setName("Pause before detecting")
      .setDesc("How long you must stop typing, in milliseconds, before the scene is checked.")
      .addSlider((sl) =>
        sl
          .setLimits(500, 4000, 100)
          .setValue(s.autoLinkIdleMs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.autoLinkIdleMs = v;
            await this.plugin.persist();
          })
      );

    new Setting(aids)
      .setName("Daily word goal")
      .setDesc("Words per day the goal bar counts toward. 0 turns the goal off.")
      .addText((t) =>
        t.setValue(String(s.dailyGoal)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n) && n >= 0) {
            s.dailyGoal = n;
            await this.plugin.persist();
          }
        })
      );

    new Setting(aids)
      .setName("Hide properties in project notes")
      .setDesc("Hide the Properties block in project notes. Edit them in File info.")
      .addToggle((t) =>
        t.setValue(s.hideProperties).onChange(async (v) => {
          s.hideProperties = v;
          await this.plugin.persist();
          this.plugin.applyProperties();
        })
      );

    new Setting(aids)
      .setName("Hide formatting marks while editing")
      .setDesc("Hide the ** and * around bold and italic words (Live Preview).")
      .addToggle((t) =>
        t.setValue(s.hideMarks).onChange(async (v) => {
          s.hideMarks = v;
          await this.plugin.persist();
          this.plugin.applyMarks();
        })
      );

    new Setting(timeline)
      .setName("Move a life's scenes with it")
      .setDesc("When you drag a life bar on the timeline, shift every scene linked to that life by the same amount.")
      .addToggle((t) =>
        t.setValue(s.timelineMoveScenesWithLife).onChange(async (v) => {
          s.timelineMoveScenesWithLife = v;
          await this.plugin.persist();
        })
      );
    new Setting(maps)
      .setName("Maps settings")
      .setDesc("Add drawn maps with their own coordinates and grids, switch the real-world map off, and choose how maps are drawn on this computer.")
      .addButton((b) =>
        b.setButtonText("Open").onClick(() => {
          (this.app as any).commands.executeCommandById("booker:open-maps-settings");
        })
      );
    this.scripture(bible);
    new Setting(bible)
      .setName("Show what my notes quote in the Reader")
      .setDesc("Colour verses and passages your notes quote, with a Go to button.")
      .addToggle((t) =>
        t.setValue(s.showQuoted).onChange(async (v) => {
          s.showQuoted = v;
          await this.plugin.persist();
          this.plugin.refreshQuoted();
        })
      );
    this.semantic(search);
    this.dictionarySection(dict);

    new Setting(exp)
      .setName("Export folder")
      .setDesc("Where exports are saved, relative to the vault.")
      .addText((t) =>
        t.setValue(s.exportFolder).onChange(async (v) => {
          s.exportFolder = v.trim() || "Booker Exports";
          await this.plugin.persist();
        })
      );
    new Setting(exp)
      .setName("Author name")
      .setDesc("Used on title pages and ebook metadata.")
      .addText((t) =>
        t.setValue(s.authorName).onChange(async (v) => {
          s.authorName = v.trim();
          await this.plugin.persist();
        })
      );
    new Setting(exp)
      .setName("Surname for running headers")
      .setDesc("Manuscript format puts 'Surname / TITLE / page' at the top of every page.")
      .addText((t) =>
        t.setValue(s.authorSurname).onChange(async (v) => {
          s.authorSurname = v.trim();
          await this.plugin.persist();
        })
      );
    new Setting(exp)
      .setName("Contact block")
      .setDesc("Name, address, email and phone for the manuscript title page.")
      .addTextArea((t) =>
        t.setValue(s.authorContact).onChange(async (v) => {
          s.authorContact = v;
          await this.plugin.persist();
        })
      );
    new Setting(exp)
      .setName("Scene break mark")
      .setDesc("Printed between scenes, such as * * *  or  #  or  ❦")
      .addText((t) =>
        t.setValue(s.sceneBreak).onChange(async (v) => {
          s.sceneBreak = v || "* * *";
          await this.plugin.persist();
        })
      );
    new Setting(exp)
      .setName("Include scenes at or above status")
      .addDropdown((d) => {
        for (const st of STATUSES) d.addOption(st, st);
        d.setValue(s.exportMinStatus).onChange(async (v) => {
          s.exportMinStatus = v as Status;
          await this.plugin.persist();
        });
      });
    new Setting(exp)
      .setName("Trim size for print PDF")
      .addDropdown((d) =>
        d
          .addOptions({ "5.5x8.5": "5.5 x 8.5 in (digest)", "6x9": "6 x 9 in (trade)", "5x8": "5 x 8 in", a5: "A5" })
          .setValue(s.trimSize)
          .onChange(async (v) => {
            s.trimSize = v as typeof s.trimSize;
            await this.plugin.persist();
          })
      );
  }

  private dictionarySection(el: HTMLElement) {
    const plugin = this.plugin;
    const r = ENGLISH_RESOURCES[0];
    const row = new Setting(el).setName("English dictionary").setDesc(`${r.title}, about 10 MB.`);
    void plugin.english.load().then((idx) => {
      if (idx) {
        row.setDesc(`Installed: ${idx.size.toLocaleString()} words.`);
        row.addButton((b) => b.setButtonText("Open the card").onClick(() => void plugin.openSidebar("dictionary")));
      } else
        row.addButton((b) =>
          b.setButtonText(plugin.resources.available ? "Download" : "Needs the desktop app").setCta().setDisabled(!plugin.resources.available).onClick(async () => {
            b.setDisabled(true).setButtonText("Downloading…");
            await plugin.resources.installDictionary(r);
            plugin.english.reset();
            this.renderInto(this.target);
          })
        );
    });
    new Setting(el)
      .setName("Suggest richer words")
      .setDesc("Off by default. A bar of SAT-level alternatives appears over a plain word as you write it.")
      .addToggle((t) =>
        t.setValue(plugin.settings.vocabSuggest).onChange(async (v) => {
          plugin.settings.vocabSuggest = v;
          await plugin.persist();
        })
      );
  }

  /** One row per model that can be downloaded: its size, whether it is installed, and the button. */
  private modelDownloads(el: HTMLElement) {
    const plugin = this.plugin;
    const box = el.createDiv({ cls: "booker-downloads" });
    for (const r of MODEL_RESOURCES) {
      const row = new Setting(box).setName(r.title).setDesc(`${r.note} ${formatSize(totalSize(r))}. ${r.license}.`);
      const draw = async (): Promise<void> => {
        row.clear();
        row.setName(r.title).setDesc(`${r.note} ${formatSize(totalSize(r))}. ${r.license}.`);
        if (!plugin.resources.available) {
          row.addExtraButton((b) => b.setIcon("monitor").setTooltip("Downloads need the desktop app").setDisabled(true));
          return;
        }
        if (plugin.resources.isRunning(r)) {
          row.addButton((b) => b.setButtonText("Cancel").onClick(() => plugin.resources.cancel(r)));
          return;
        }
        if (await plugin.resources.installed(r)) {
          row.addExtraButton((b) => b.setIcon("check").setTooltip("Installed").setDisabled(true));
          row.addButton((b) =>
            b.setButtonText("Remove").onClick(async () => {
              await plugin.resources.remove(r);
              void draw();
            })
          );
        } else
          row.addButton((b) =>
            b.setButtonText("Download").setCta().onClick(async () => {
              const done = plugin.resources.install(r);
              void draw();
              await done;
              void draw();
            })
          );
      };
      void draw();
    }
  }

  private semantic(el: HTMLElement) {
    const plugin = this.plugin;
    el.createEl("p", { cls: "setting-item-description", text: "Find passages by meaning. Runs on this computer; goes online only when you press Download." });
    this.modelDownloads(el);
    new Setting(el).setName("Resource manager").setDesc("Every model, library and work you can download.").addButton((b) => b.setButtonText("Open").onClick(() => new ResourceManager(this.plugin).open()));
    const row = new Setting(el).setName("Model").setDesc("Checking the installed models…");
    void plugin.semantic.models(true).then((models) => {
      if (!models.length) {
        // not `return row.setDesc(...)`: a Setting is thenable, so returning it from a promise callback never settles
        row.setDesc("No model installed, so meaning search is off. Download one above.");
        return;
      }
      row.setDesc("The first is fastest. Changing it re-indexes libraries on next search.");
      row.addDropdown((d) => {
        for (const m of models) d.addOption(m.id, m.label);
        d.setValue(plugin.scriptureData().semanticModel ?? models.find((m) => m.id === "bge-micro-v2")?.id ?? models[0].id).onChange(async (v) => {
          await plugin.saveScripture({ ...plugin.scriptureData(), semanticModel: v });
        });
      });
      new Setting(el)
        .setName("Speed test")
        .setDesc("Time each installed model on sample sentences.")
        .addButton((b) => b.setButtonText("Run").onClick(async () => {
          b.setDisabled(true).setButtonText("Running…");
          await runSelfTest(plugin);
          b.setDisabled(false).setButtonText("Run");
        }));
      new Setting(el)
        .setName("Index every library now")
        .setDesc("Index all libraries now, instead of on first search.")
        .addButton((b) => b.setButtonText("Index").onClick(async () => {
          b.setDisabled(true);
          const r = await plugin.semanticIndex.indexAll(plugin.sources(), (m) => b.setButtonText(m.length > 40 ? `${m.slice(0, 38)}…` : m));
          b.setButtonText("Index").setDisabled(false);
          new Notice(`Booker: indexed ${r.done} source${r.done === 1 ? "" : "s"}${r.failed ? `, ${r.failed} could not be read` : ""}.`);
        }))
        .addButton((b) => b.setButtonText("Stop").onClick(() => (plugin.semanticIndex.stopFlag = true)));
      new Setting(el)
        .setName("Write scene summaries in the background")
        .setDesc("Off by default. The writing model summarises changed scenes. Runs on this computer.")
        .addToggle((t) =>
          t.setValue(plugin.settings.autoSceneSummaries).onChange(async (v) => {
            plugin.settings.autoSceneSummaries = v;
            await plugin.persist();
          })
        );
      new Setting(el)
        .setName("Manage indexes")
        .setDesc("See, clear or rebuild library indexes.")
        .addButton((b) => b.setButtonText("Open").onClick(() => new IndexModal(plugin).open()));
      const list = plugin.sources();
      if (list.length) {
        const det = el.createEl("details", { cls: "booker-semantic-sources" });
        det.createEl("summary", { text: "Libraries and documents searched by meaning" });
        for (const src of list) {
          new Setting(det).setName(src.title || src.uid).addToggle((t) =>
            t.setValue(!(plugin.scriptureData().semanticSkip ?? []).includes(src.uid)).onChange(async (on) => {
              const skip = new Set(plugin.scriptureData().semanticSkip ?? []);
              if (on) skip.delete(src.uid);
              else skip.add(src.uid);
              await plugin.saveScripture({ ...plugin.scriptureData(), semanticSkip: [...skip] });
            })
          );
        }
      }
    });
  }

  private scripture(el: HTMLElement) {
    const plugin = this.plugin;
    new Setting(el)
      .setName("Scripture bar")
      .setDesc("Insert and Read buttons over a scripture reference; Shift+Space writes one out.")
      .addToggle((t) =>
        t.setValue(plugin.settings.scriptureAssist).onChange(async (v) => {
          plugin.settings.scriptureAssist = v;
          await plugin.persist();
        })
      );
    new Setting(el)
      .setName("Extra Bible modules folder")
      .setDesc("Modules here are read as well as Booker/Library/Bibles.")
      .addText((t) =>
        t.setPlaceholder(DEFAULT_FOLDER).setValue(plugin.scriptureData().folder).onChange(async (v) => {
          const d = plugin.scriptureData();
          await plugin.saveScripture({ ...d, folder: v.trim() || DEFAULT_FOLDER });
        })
      )
      .addButton((b) => b.setButtonText("Add module…").onClick(async () => {
        await plugin.addBibleModules();
        this.renderInto(this.target);
      }));
    const list = el.createDiv();
    void plugin.modules.list().then((mods) => {
      if (!mods.length) return list.createDiv({ cls: "booker-muted", text: "No modules yet." });
      const d = plugin.scriptureData();
      for (const m of mods) {
        const row = new Setting(list).setName(m.name).setDesc(m.kind === "bible" || m.kind === "xml" ? "Bible" : m.kind === "commentary" ? "Commentary" : "Dictionary");
        if (m.kind === "bible" || m.kind === "xml")
          row.addButton((b) => b.setButtonText(d.defaultModule === m.path ? "Default" : "Make default").setDisabled(d.defaultModule === m.path).onClick(async () => {
            await plugin.saveScripture({ ...plugin.scriptureData(), defaultModule: m.path });
            this.renderInto(this.target);
          }));
        row.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove from the folder").onClick(async () => {
          await plugin.modules.remove(m.path);
          this.renderInto(this.target);
        }));
      }
    });
  }
}
