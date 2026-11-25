import { Modal, Notice, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { RESOURCES } from "../resources/catalog";
import { CataloguePicker } from "./cataloguePicker";
import { ConfirmModal } from "../ui";
import { formatSize, totalSize, type Resource } from "../resources/types";

const GROUP_ORDER = ["Search models", "Writing model", "Dictionary and thesaurus", "Word study", "Maps", "Church writings", "Bibles", "Medieval and late antique", "Papyri", "CCEL works"];

type State = "installed" | "running" | "missing" | "manual";

/** The window: a title and the panel. */
export class ResourceManager extends Modal {
  private panel: ResourcesPanel | null = null;

  constructor(private plugin: BookerPlugin) {
    super(plugin.app);
  }

  onOpen() {
    this.modalEl.addClass("booker-resources");
    this.contentEl.createEl("h3", { text: "Resource manager" });
    this.panel = new ResourcesPanel(this.plugin, this.contentEl);
    this.panel.mount();
  }

  onClose() {
    this.panel?.destroy();
    this.contentEl.empty();
  }
}

/** Everything Booker can download or knows about: size, whether you have it, and a button. Used in the window and as a step when making a project. */
export class ResourcesPanel {
  private states = new Map<string, State>();
  private off: (() => void) | null = null;
  private filter = "";
  private list!: HTMLElement;

  constructor(private plugin: BookerPlugin, private host: HTMLElement) {}

  mount() {
    const contentEl = this.host;
    contentEl.createEl("p", { cls: "booker-muted", text: this.plugin.resources.available ? "Models, libraries and works you can download. Each download runs in the background; watch it from the circle in the hub." : "Downloads need the desktop app. The list below shows what exists." });
    const top = contentEl.createDiv({ cls: "booker-res-top" });
    const search = top.createEl("input", { type: "text", cls: "booker-input", attr: { placeholder: "Filter" } });
    search.addEventListener("input", () => {
      this.filter = search.value.trim().toLowerCase();
      this.draw();
    });
    this.everything = top.createEl("button", { text: "Download all", cls: "mod-cta booker-res-all" });
    this.everything.addEventListener("click", () => this.downloadEverything());
    this.list = contentEl.createDiv({ cls: "booker-res-list" });
    this.off = this.plugin.tasks.subscribe(() => this.tick());
    void this.refresh();
  }

  destroy() {
    this.off?.();
    this.off = null;
  }

  private everything!: HTMLButtonElement;

  /** What is missing and can be fetched without choosing: plain downloads, the big archives, the word-for-word Bible, and the website sets. */
  private wanted(): Resource[] {
    return RESOURCES.filter((r) => this.states.get(r.id) === "missing" && (r.files.length || r.kind === "archive" || r.kind === "interlinear" || (r.kind === "catalogue" && r.source)));
  }

  private downloadEverything() {
    const plugin = this.plugin;
    if (!plugin.resources.available) return void new Notice("Booker: downloads need the desktop app.");
    const todo = this.wanted();
    if (!todo.length) return void new Notice("Booker: everything is already in your library.");
    const known = todo.reduce((n, r) => n + totalSize(r), 0);
    const big = todo.filter((r) => r.kind === "archive" || r.kind === "catalogue").map((r) => r.title);
    const body = `${todo.length} item${todo.length === 1 ? "" : "s"}: ${formatSize(known)} of direct downloads${big.length ? `, plus ${big.join(", ")}, which are fetched page by page or unpacked after a large download and can take hours` : ""}. They run in the background; watch them from the circle in the hub.`;
    new ConfirmModal(plugin.app, "Download everything?", body, "Download all", () => {
      const sequence = async () => {
        // the interlinear Bible is made from the word-for-word data, so it waits for that
        const interlinear = todo.filter((r) => r.kind === "interlinear");
        const wave = todo.filter((r) => r.kind !== "interlinear" && r.kind !== "catalogue");
        await Promise.all(wave.map((r) => plugin.resources.installAny(r)));
        await Promise.all(interlinear.map((r) => plugin.resources.installAny(r)));
      };
      void sequence().then(() => this.refresh());
      // website sets one after the other, so the sites are not asked for several things at once
      void (async () => {
        for (const r of todo.filter((x) => x.kind === "catalogue" && x.source)) {
          try {
            const items = await plugin.resources.catalogue(r.source!);
            await plugin.resources.installCatalogue(r.source!, items);
          } catch (e) {
            new Notice(`Booker: ${r.title}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        void this.refresh();
      })();
      void this.refresh();
    }).open();
  }

  /** What is already in the library, by the names of its sources and modules. */
  private async have(): Promise<string[]> {
    const names = this.plugin.sources().flatMap((s) => [s.title, s.container ?? ""]);
    try {
      for (const m of await this.plugin.modules.list()) names.push(m.name);
    } catch {
      /* no modules folder */
    }
    return names.filter(Boolean);
  }

  private bars = new Map<string, { bar: HTMLElement; text: HTMLElement; r: Resource }>();

  /** A background task changed: move the progress bars of what is downloading; redo the list only when one finished or began. */
  private tick() {
    const running = new Set(RESOURCES.filter((r) => this.isRunning(r)).map((r) => r.id));
    const was = new Set([...this.states].filter(([, s]) => s === "running").map(([id]) => id));
    if (running.size !== was.size || [...running].some((id) => !was.has(id))) return void this.refresh();
    for (const { bar, text, r } of this.bars.values()) {
      const t = this.plugin.resources.taskOf(r);
      if (!t) continue;
      const pct = t.total ? Math.min(100, Math.round((t.done / t.total) * 100)) : 0;
      bar.style.width = t.total ? `${pct}%` : "";
      bar.toggleClass("is-busy", !t.total);
      text.setText(t.total ? `${pct}%${t.detail ? ` · ${t.detail}` : ""}` : t.detail || "Working…");
    }
  }

  private isRunning(r: Resource): boolean {
    return this.plugin.resources.isRunning(r) || (!!r.source && this.plugin.resources.isCatalogueRunning(r.source));
  }

  private async refresh() {
    const names = await this.have();
    for (const r of RESOURCES) {
      let s: State;
      if (this.isRunning(r)) s = "running";
      else if (r.kind === "model" || r.kind === "gen") s = (await this.plugin.resources.installed(r)) ? "installed" : "missing";
      else if (r.kind === "places") s = (await this.plugin.places.status())[r.id === "places-postal" ? "postal" : "cities"] ? "installed" : "missing";
      else if (r.kind === "wordstudy") s = (await this.plugin.wordData.available()) ? "installed" : "missing";
      else if (r.kind === "interlinear") s = names.some((n) => n.toLowerCase().startsWith("berean interlinear")) ? "installed" : "missing";
      else if (r.kind === "dictionary") s = names.some((n) => n.toLowerCase().startsWith(r.dict!.title.toLowerCase())) ? "installed" : "missing";
      else if (r.id === "hcf-commentaries") s = names.some((n) => /^Church Fathers Commentary(\.cmt\.mybible)?$/i.test(n)) ? "installed" : "missing";
      else if (r.detect && names.some((n) => new RegExp(r.detect!, "i").test(n))) s = "installed";
      else s = r.kind === "library" ? "manual" : "missing";
      this.states.set(r.id, s);
    }
    this.draw();
  }

  private draw() {
    const box = this.list;
    box.empty();
    this.bars.clear();
    const want = this.wanted();
    this.everything.setText(want.length ? `Download all (${want.length})` : "All downloaded");
    this.everything.disabled = !want.length || !this.plugin.resources.available;
    const groups = [...new Set(RESOURCES.map((r) => r.group))].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
    for (const g of groups) {
      const rows = RESOURCES.filter((r) => r.group === g && (!this.filter || `${r.title} ${r.note}`.toLowerCase().includes(this.filter)));
      if (!rows.length) continue;
      const head = box.createDiv({ cls: "booker-res-group" });
      head.createEl("strong", { text: g });
      // everything in the group that has a plain download and is not there yet (catalogues and big archives are chosen one by one)
      const todo = rows.filter((r) => this.states.get(r.id) === "missing" && r.files.length && r.kind !== "interlinear" && r.kind !== "catalogue" && r.kind !== "archive");
      if (todo.length > 1 && this.plugin.resources.available) {
        const all = head.createEl("button", { text: `Download all (${formatSize(todo.reduce((n, r) => n + totalSize(r), 0))})` });
        all.addEventListener("click", () => void Promise.all(todo.map((r) => this.plugin.resources.installAny(r))).then(() => this.refresh()));
      }
      for (const r of rows) this.row(box, r);
    }
  }

  private row(box: HTMLElement, r: Resource) {
    const state = this.states.get(r.id) ?? "missing";
    const row = box.createDiv({ cls: `booker-res-row is-${state}` });
    const text = row.createDiv({ cls: "booker-res-text" });
    text.createDiv({ cls: "booker-res-title", text: r.title });
    text.createDiv({ cls: "booker-muted", text: r.note });
    const size = r.files.length ? formatSize(totalSize(r)) : r.sizeNote ?? "";
    text.createDiv({ cls: "booker-muted booker-res-meta", text: [size, r.license].filter(Boolean).join(" · ") });
    const acts = row.createDiv({ cls: "booker-res-acts" });
    if (state === "installed") {
      const ok = acts.createSpan({ cls: "booker-res-ok" });
      setIcon(ok, "check");
      ok.createSpan({ text: "In your library" });
      if (r.files.length && r.kind !== "wordstudy" && r.kind !== "dictionary" && r.kind !== "bible") acts.createEl("button", { text: "Remove" }).addEventListener("click", async () => {
        if (r.kind === "places") await this.plugin.resources.removePlaces(r);
        else await this.plugin.resources.remove(r);
        void this.refresh();
      });
    } else if (state === "running") {
      const prog = text.createDiv({ cls: "booker-res-progress" });
      const bar = prog.createDiv({ cls: "booker-res-bar" }).createDiv();
      const note = text.createDiv({ cls: "booker-muted booker-res-meta" });
      this.bars.set(r.id, { bar, text: note, r });
      this.tick();
      const t = this.plugin.resources.taskOf(r);
      acts.createEl("button", { text: "Cancel" }).addEventListener("click", () => (r.source && !this.plugin.resources.isRunning(r) ? t?.cancel?.() : this.plugin.resources.cancel(r)));
    } else if (r.kind === "interlinear" || r.files.length) {
      const b = acts.createEl("button", { text: "Download", cls: "mod-cta" });
      b.disabled = !this.plugin.resources.available;
      b.addEventListener("click", () => void this.plugin.resources.installAny(r).then(() => this.refresh()));
    } else if (r.kind === "catalogue" && r.source) {
      const b = acts.createEl("button", { text: "Choose…", cls: "mod-cta" });
      b.disabled = !this.plugin.resources.available;
      b.addEventListener("click", () => new CataloguePicker(this.plugin, r.source!).open());
      acts.createEl("button", { text: "Open page" }).addEventListener("click", () => window.open(r.page!));
    } else if (r.kind === "archive") {
      const b = acts.createEl("button", { text: "Download and add", cls: "mod-cta" });
      b.disabled = !this.plugin.resources.available;
      b.addEventListener("click", () =>
        new ConfirmModal(this.plugin.app, `Download ${r.title}?`, `${r.sizeNote}. Booker downloads the repository once from GitHub, makes the libraries, then deletes the download. It runs in the background and takes several minutes.`, "Download", () => void this.plugin.resources.installArchive(r).then(() => this.refresh())).open()
      );
      acts.createEl("button", { text: "Open page" }).addEventListener("click", () => window.open(r.page!));
    } else if (r.page) {
      const b = acts.createEl("button", { text: "Open page" });
      b.addEventListener("click", () => window.open(r.page!));
      acts.createSpan({ cls: "booker-muted", text: "Download here is coming" });
    }
  }
}
