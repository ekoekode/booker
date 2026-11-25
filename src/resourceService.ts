/** Downloads for the app: models and libraries the user chooses to fetch. Each one runs as a background task, so the hub shows it. */
import { FileSystemAdapter, Notice, Platform } from "obsidian";
import type BookerPlugin from "./main";
import { Cancelled, downloadFile, fetchBytes, installResource, isInstalled, Pacer, type IO } from "./resources/fetcher";
import { buildItems, listSource } from "./resources/catalogueRun";
import { catalogueSource, type CatItem } from "./resources/catalogueSources";
import { importIncoming } from "./library/importer";
import { LIBRARY_ROOT } from "./library/paths";
import { formatSize, type Resource } from "./resources/types";
import { resourceFolder, WORDSTUDY_RESOURCES } from "./resources/catalog";
import { BOOKS } from "./scripture/books";
import { INTERLINEAR_TITLE, interlinearVerse } from "./scripture/interlinearBible";
import type { IBook } from "./scripture/interlinear";
import type { BibleRow } from "./sources/bibleWrite";
import type { BgTask } from "./tasks/tracker";

export class ResourceService {
  private running = new Map<string, { task: BgTask; abort: AbortController }>();
  private io: IO | null = null;
  private pacer: Pacer | null = null;

  constructor(private plugin: BookerPlugin) {}

  /** Downloading needs Node, which only the desktop app has. */
  get available(): boolean {
    return Platform.isDesktopApp && this.plugin.app.vault.adapter instanceof FileSystemAdapter;
  }

  private async engine(): Promise<{ io: IO; pacer: Pacer }> {
    if (!this.io || !this.pacer) {
      const { nodeIO } = await import("./resources/nodeIO");
      this.io = nodeIO();
      this.pacer = new Pacer(this.io);
    }
    return { io: this.io, pacer: this.pacer };
  }

  private pluginDir(): string {
    return this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/booker`;
  }

  /** The folder on disk a resource is kept in. */
  absDir(r: Resource): string {
    const a = this.plugin.app.vault.adapter as FileSystemAdapter;
    return `${a.getBasePath()}/${this.pluginDir()}/${resourceFolder(r)}/${r.id}`;
  }

  isRunning(r: Resource): boolean {
    return this.running.has(r.id);
  }

  async installed(r: Resource): Promise<boolean> {
    if (!this.available) return false;
    const { io } = await this.engine();
    return isInstalled(io, r, this.absDir(r));
  }

  /** Fetch one file into memory (a small web request, or a release zip). Desktop only. */
  async fetchBytes(url: string, opts: { signal?: AbortSignal; max?: number } = {}): Promise<Uint8Array> {
    const { io, pacer } = await this.engine();
    return fetchBytes(io, pacer, url, opts);
  }

  /** The background task of a resource that is downloading now, for progress bars. */
  taskOf(r: Resource): BgTask | undefined {
    return this.running.get(r.id)?.task ?? (r.source ? this.running.get(r.source)?.task : undefined);
  }

  /** Start whichever download fits the kind of resource. Catalogues and big archives are chosen or confirmed in their own windows. */
  async installAny(r: Resource): Promise<void> {
    if (r.kind === "bible") return this.installBible(r);
    if (r.kind === "places") return this.installPlaces(r);
    if (r.kind === "wordstudy") return this.installWordStudy(r);
    if (r.kind === "dictionary") return this.installDictionary(r);
    if (r.kind === "interlinear") return this.installInterlinear(r);
    if (r.kind === "archive") return this.installArchive(r);
    if (r.files.length) return this.install(r);
  }

  /** Download a Bible from eBible.org and add it to the Bibles. */
  async installBible(r: Resource): Promise<void> {
    if (!this.available) return void new Notice("Booker: downloads need the desktop app.");
    if (this.running.has(r.id)) return;
    const { io, pacer } = await this.engine();
    const abort = new AbortController();
    const tracker = this.plugin.tasks;
    const task = tracker.add(`Downloading ${r.title}`, { state: "running", cancel: () => abort.abort() });
    this.running.set(r.id, { task, abort });
    try {
      const bytes = await fetchBytes(io, pacer, r.files[0].url, { signal: abort.signal, max: 100 * 1024 * 1024 });
      tracker.update(task, { detail: "Unpacking" });
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(bytes);
      const entry = Object.values(zip.files).find((e) => !e.dir && /_usfx\.xml$/i.test(e.name));
      if (!entry) throw new Error("The download has no Bible text in it");
      const data = (await entry.async("uint8array")).slice().buffer as ArrayBuffer;
      await this.plugin.modules.add(`${r.title}.usfx`, data);
      tracker.finish(task, "done", r.title);
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) tracker.finish(task, "cancelled", "Cancelled");
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(r.id);
    }
  }

  cancel(r: Resource) {
    this.running.get(r.id)?.abort.abort();
  }

  /** Download a resource in the background. Resolves when it has finished, failed or been cancelled. */
  async install(r: Resource): Promise<void> {
    if (!this.available) return void new Notice("Booker: downloads need the desktop app.");
    if (this.running.has(r.id)) return;
    const { io, pacer } = await this.engine();
    const abort = new AbortController();
    const tracker = this.plugin.tasks;
    const task = tracker.add(`Downloading ${r.title}`, { state: "running", cancel: () => abort.abort() });
    this.running.set(r.id, { task, abort });
    try {
      await installResource(io, pacer, r, this.absDir(r), {
        signal: abort.signal,
        onProgress: (done, total, file) => tracker.update(task, { done, total, detail: `${file} · ${formatSize(done)} of ${formatSize(total)}` }),
      });
      tracker.finish(task, "done", formatSize(task.total));
      await this.refresh(r);
    } catch (e) {
      if (e instanceof Cancelled) tracker.finish(task, "cancelled", "Cancelled");
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(r.id);
    }
  }

  // ---------------------------------------------------------------- websites, item by item

  private stateFile = `${LIBRARY_ROOT}/.catalogues.json`;
  private states: Record<string, { fetched?: number; items?: CatItem[]; done?: string[] }> | null = null;

  private async allState() {
    if (this.states) return this.states;
    const a = this.plugin.app.vault.adapter;
    try {
      this.states = (await a.exists(this.stateFile)) ? JSON.parse(await a.read(this.stateFile)) : {};
      // the 0.58 CCEL list: works already added carry over
      const legacy = `${LIBRARY_ROOT}/.ccel.json`;
      if (!this.states!.ccel && (await a.exists(legacy))) {
        const old = JSON.parse(await a.read(legacy)) as { done?: string[] };
        this.states!.ccel = { done: old.done ?? [] };
      }
    } catch {
      this.states = {};
    }
    return this.states!;
  }

  private async state(id: string) {
    const all = await this.allState();
    return (all[id] ??= {});
  }

  private async saveState() {
    const a = this.plugin.app.vault.adapter;
    if (!(await a.exists(LIBRARY_ROOT))) await a.mkdir(LIBRARY_ROOT);
    await a.write(this.stateFile, JSON.stringify(this.states ?? {}));
  }

  /** The items a site offers, from the saved list unless it is old or `refresh` is set. */
  async catalogue(sourceId: string, refresh = false, signal?: AbortSignal): Promise<CatItem[]> {
    const source = catalogueSource(sourceId);
    if (!source) throw new Error(`Unknown source ${sourceId}`);
    const st = await this.state(sourceId);
    const fresh = st.items?.length && st.fetched && Date.now() - st.fetched < 14 * 86400000;
    if (fresh && !refresh) return st.items!;
    if (!this.available) return st.items ?? [];
    const { io, pacer } = await this.engine();
    st.items = await listSource(source, { io, pacer, signal });
    st.fetched = Date.now();
    await this.saveState();
    return st.items;
  }

  async catalogueDone(sourceId: string): Promise<Set<string>> {
    return new Set((await this.state(sourceId)).done ?? []);
  }

  isCatalogueRunning(sourceId: string): boolean {
    return this.running.has(sourceId);
  }

  /** Fetch each item at its site's pace, make it a library and add it. Stops at once on cancel; items already added are skipped next time. */
  async installCatalogue(sourceId: string, items: CatItem[]): Promise<void> {
    const source = catalogueSource(sourceId);
    if (!source) return;
    if (!this.available) return void new Notice("Booker: downloads need the desktop app.");
    if (this.running.has(sourceId)) return;
    const { io, pacer } = await this.engine();
    const abort = new AbortController();
    const tracker = this.plugin.tasks;
    const st = await this.state(sourceId);
    const done = new Set(st.done ?? []);
    const todo = items.filter((i) => !done.has(i.id));
    const task = tracker.add(`Downloading ${source.noun}`, { state: "running", total: todo.length, cancel: () => abort.abort() });
    this.running.set(sourceId, { task, abort });
    let added = 0;
    let failed = 0;
    try {
      const r = await buildItems(source, todo, { io, pacer, signal: abort.signal, say: (detail) => tracker.update(task, { detail }) }, {
        onItem: (i, _n, item) => tracker.update(task, { done: i, detail: item.title }),
        onFail: (item, error) => tracker.update(task, { detail: `${item.title}: ${error}` }),
        onLibrary: async (item, fileName, data) => {
          const res = await importIncoming(this.plugin, [{ name: fileName, rel: fileName, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }], { index: false });
          if (res[0]?.status === "failed") throw new Error(res[0].message);
          done.add(item.id);
          st.done = [...done];
          if (++added % 10 === 0) await this.saveState();
        },
      });
      failed = r.failed;
      tracker.update(task, { done: todo.length });
      tracker.finish(task, "done", `${r.added} added${failed ? `, ${failed} could not be fetched` : ""}`);
    } catch (e) {
      if (e instanceof Cancelled) tracker.finish(task, "cancelled", `${added} added before it stopped`);
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      st.done = [...done];
      await this.saveState().catch(() => undefined);
      this.running.delete(sourceId);
    }
  }

  // ---------------------------------------------------------------- one big archive, many libraries

  /** Download a repository archive and make one library per author or Father from it. The archive is deleted afterwards. */
  async installArchive(r: Resource): Promise<void> {
    if (!r.archive) return;
    if (!this.available) return void new Notice("Booker: downloads need the desktop app.");
    if (this.running.has(r.id)) return;
    const { io, pacer } = await this.engine();
    const abort = new AbortController();
    const tracker = this.plugin.tasks;
    const task = tracker.add(`Downloading ${r.title}`, { state: "running", cancel: () => abort.abort() });
    this.running.set(r.id, { task, abort });
    const a = this.plugin.app.vault.adapter as FileSystemAdapter;
    const file = `${a.getBasePath()}/${this.pluginDir()}/downloads/${r.id}.tar.gz`;
    let made = 0;
    try {
      await downloadFile(io, pacer, { url: r.archive.url, to: `${r.id}.tar.gz` }, file, {
        signal: abort.signal,
        onBytes: (n) => tracker.update(task, { done: task.done + n, detail: `${formatSize(task.done + n)} downloaded` }),
      });
      tracker.update(task, { done: 0, total: 0, detail: "Unpacking" });
      const { convertHcf } = await import("./resources/hcfArchive");
      let added = 0;
      let skipped = 0;
      const notes: import("./resources/hcf").CommentNote[] = [];
      await convertHcf(
        r.archive.kind,
        file,
        async (lib) => {
          if (lib.notes) for (const n of lib.notes) notes.push(n);
          const res = await importIncoming(this.plugin, [{ name: lib.fileName, rel: lib.fileName, data: lib.data.buffer.slice(lib.data.byteOffset, lib.data.byteOffset + lib.data.byteLength) as ArrayBuffer }], { index: false });
          if (res[0]?.status === "added") added++;
          else if (res[0]?.status === "skipped") skipped++;
          else throw new Error(res[0]?.message ?? "could not be added");
          tracker.update(task, { detail: `${lib.title} (${added + skipped} done)` });
        },
        (detail) => tracker.update(task, { detail: `Reading ${detail}` }),
        abort.signal
      );
      made = added;
      await io.remove(file).catch(() => undefined);
      if (notes.length) {
        // the same comments as one commentary, so the Bible references window and the Reader show them beside each verse
        tracker.update(task, { detail: `Making the commentary (${notes.length.toLocaleString()} notes)` });
        const { buildCommentary } = await import("./sources/commentaryWrite");
        const data = await buildCommentary("Church Fathers Commentary", "CFC", "Made by Booker from HistoricalChristianFaith's Commentaries-Database.", notes);
        await this.plugin.modules.add("Church Fathers Commentary.cmt.mybible", data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      }
      tracker.finish(task, "done", `${added} libraries added${skipped ? `, ${skipped} already there` : ""}${notes.length ? `; commentary of ${notes.length.toLocaleString()} notes added` : ""}`);
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) tracker.finish(task, "cancelled", made ? `${made} added before it stopped` : "Cancelled");
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(r.id);
    }
  }

  // ---------------------------------------------------------------- word study data

  /** Where the per-book word-for-word files are kept, relative to the vault. */
  wordStudyDir(): string {
    return `${this.pluginDir()}/wordstudy`;
  }

  /** Download the Berean tables and split them into one small file per book. The big download is deleted afterwards. */
  async installWordStudy(r: Resource): Promise<void> {
    if (!this.available) return void new Notice("Booker: downloads need the desktop app.");
    if (this.running.has(r.id)) return;
    const { io, pacer } = await this.engine();
    const abort = new AbortController();
    const tracker = this.plugin.tasks;
    const task = tracker.add(`Downloading ${r.title}`, { state: "running", cancel: () => abort.abort() });
    this.running.set(r.id, { task, abort });
    const adapter = this.plugin.app.vault.adapter as FileSystemAdapter;
    const file = `${adapter.getBasePath()}/${this.pluginDir()}/downloads/${r.files[0].to}`;
    try {
      await downloadFile(io, pacer, r.files[0], file, {
        signal: abort.signal,
        onBytes: (n) => tracker.update(task, { done: task.done + n, total: r.files[0].size ?? 0, detail: `${formatSize(task.done + n)} downloaded` }),
      });
      tracker.update(task, { done: 0, total: 0, detail: "Splitting into books" });
      const dir = this.wordStudyDir();
      if (!(await this.plugin.app.vault.adapter.exists(dir))) await this.plugin.app.vault.adapter.mkdir(dir);
      const { convertBerean } = await import("./resources/bereanArchive");
      const n = await convertBerean(file, async (osis, data) => {
        await this.plugin.app.vault.adapter.write(`${dir}/${osis}.json`, JSON.stringify(data));
        tracker.update(task, { detail: osis });
      }, abort.signal);
      await io.remove(file).catch(() => undefined);
      this.plugin.wordData.forget();
      tracker.finish(task, "done", `${n} books`);
      void this.plugin.align.ensureAll();
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) tracker.finish(task, "cancelled", "Cancelled");
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(r.id);
    }
  }

  /** Make the Berean Interlinear Bible from the word-for-word data and add it to the Bibles; the data is downloaded first if it is not there. */
  async installInterlinear(r: Resource): Promise<void> {
    if (this.running.has(r.id)) return;
    const plugin = this.plugin;
    if (!(await plugin.wordData.available())) {
      const data = WORDSTUDY_RESOURCES.find((x) => x.kind === "wordstudy");
      if (data) await this.installWordStudy(data);
      if (!(await plugin.wordData.available())) return;
    }
    const abort = new AbortController();
    const tracker = plugin.tasks;
    const task = tracker.add(`Building ${r.title}`, { state: "running", cancel: () => abort.abort() });
    this.running.set(r.id, { task, abort });
    try {
      const canon = BOOKS.filter((b) => !b.extra);
      tracker.update(task, { total: canon.length });
      const rows: BibleRow[] = [];
      let done = 0;
      for (const b of canon) {
        if (abort.signal.aborted) throw new Cancelled();
        const f = `${this.wordStudyDir()}/${b.osis}.json`;
        if (await plugin.app.vault.adapter.exists(f)) {
          const book = JSON.parse(await plugin.app.vault.adapter.read(f)) as IBook;
          for (const [c, ch] of Object.entries(book))
            for (const [v, words] of Object.entries(ch)) {
              const text = interlinearVerse(words);
              if (text) rows.push({ book: b.num, chapter: Number(c), verse: Number(v), text });
            }
        }
        tracker.update(task, { done: ++done, detail: b.name });
        await new Promise((res) => setTimeout(res, 0));
      }
      if (!rows.length) throw new Error("The word-for-word data has no verses");
      tracker.update(task, { detail: "Writing the Bible" });
      const { buildBible } = await import("./sources/bibleWrite");
      const data = await buildBible(INTERLINEAR_TITLE, "BIL", "Made by Booker from the Berean Bible's translation tables (public domain). Each word is tagged with its Strong's number.", rows, true);
      await plugin.modules.add(`${INTERLINEAR_TITLE}.bbl.mybible`, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      tracker.finish(task, "done", `${rows.length} verses`);
      void plugin.align.ensureAll();
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) tracker.finish(task, "cancelled", "Cancelled");
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(r.id);
    }
  }

  /** Download a dictionary and add it as a lexicon module, where the word study finds it. */
  async installDictionary(r: Resource): Promise<void> {
    if (!r.dict) return;
    if (!this.available) return void new Notice("Booker: downloads need the desktop app.");
    if (this.running.has(r.id)) return;
    const { io, pacer } = await this.engine();
    const abort = new AbortController();
    const tracker = this.plugin.tasks;
    const task = tracker.add(`Downloading ${r.title}`, { state: "running", cancel: () => abort.abort() });
    this.running.set(r.id, { task, abort });
    try {
      const bytes = await fetchBytes(io, pacer, r.files[0].url, { signal: abort.signal });
      const text = r.dict.parse === "wordnet" ? "" : new TextDecoder().decode(bytes);
      const { parseStrongsJs, parseStepLexicon } = await import("./resources/dictionaries");
      const kind = r.dict.parse;
      const letter = kind.endsWith("-h") ? "H" : "G";
      let rows;
      if (kind === "wordnet") {
        const { gunzip } = await import("./resources/gunzip");
        const { parseWordNet, readTarBuffer } = await import("./resources/wordnet");
        const files = readTarBuffer(gunzip(bytes));
        const read = (n: string) => new TextDecoder().decode(files.get(n) ?? new Uint8Array());
        rows = parseWordNet({ noun: read("data.noun"), verb: read("data.verb"), adj: read("data.adj"), adv: read("data.adv") });
      } else rows = kind.startsWith("strongs") ? parseStrongsJs(text, letter) : parseStepLexicon(text, letter);
      if (!rows.length) throw new Error("No entries could be read from the download");
      const { buildDictionary } = await import("./sources/dictWrite");
      const data = await buildDictionary(r.dict.title, r.dict.abbr, rows);
      await this.plugin.modules.add(`${r.dict.title}.dct.mybible`, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      tracker.finish(task, "done", `${rows.length} entries`);
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) tracker.finish(task, "cancelled", "Cancelled");
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(r.id);
    }
  }

  /**
   * Add the dictionary and thesaurus that ship in the plugin's `dictionaries` folder to the library, once each. Open English
   * WordNet becomes the English dictionary and thesaurus, Moby adds more synonyms. Does nothing when the folder is not there
   * (a build without them), on a phone, or for one the author has already had. Returns true when something was added.
   */
  async installBundledDictionaries(): Promise<boolean> {
    if (!Platform.isDesktopApp) return false;
    const { app } = this.plugin;
    const dir = `${this.pluginDir()}/dictionaries`;
    const done = (this.plugin.data.bundledDictionaries ??= {});
    const have = (await this.plugin.modules.dictionaries()).map((m) => `${m.name} ${m.path}`.toLowerCase());
    const jobs = [
      { id: "oewn", version: "2025", file: "oewn-2025.tar.gz", title: "Open English WordNet", abbr: "OEWN", present: have.some((h) => h.includes("open english wordnet")) },
      { id: "moby", version: "2", file: "moby-thesaurus.txt.gz", title: "Moby Thesaurus", abbr: "Moby", present: have.some((h) => h.includes("moby")) },
    ];
    let added = false;
    for (const j of jobs) {
      if (done[j.id] === j.version) continue;
      if (j.present) {
        done[j.id] = j.version;
        continue;
      }
      if (!(await app.vault.adapter.exists(`${dir}/${j.file}`))) continue;
      const task = this.plugin.tasks.add(`Adding ${j.title}`, { state: "running" });
      try {
        const bytes = new Uint8Array(await app.vault.adapter.readBinary(`${dir}/${j.file}`));
        const { gunzip } = await import("./resources/gunzip");
        let rows;
        if (j.id === "oewn") {
          const { parseWordNet, readTarBuffer } = await import("./resources/wordnet");
          const files = readTarBuffer(gunzip(bytes));
          const read = (n: string) => new TextDecoder().decode(files.get(n) ?? new Uint8Array());
          rows = parseWordNet({ noun: read("data.noun"), verb: read("data.verb"), adj: read("data.adj"), adv: read("data.adv") });
        } else {
          const { parseMoby } = await import("./resources/moby");
          rows = parseMoby(new TextDecoder().decode(gunzip(bytes)));
        }
        if (!rows.length) throw new Error("No entries could be read");
        const { buildDictionary } = await import("./sources/dictWrite");
        const data = await buildDictionary(j.title, j.abbr, rows);
        await this.plugin.modules.add(`${j.title}.dct.mybible`, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
        done[j.id] = j.version;
        added = true;
        this.plugin.tasks.finish(task, "done", `${rows.length} entries`);
      } catch (e) {
        this.plugin.tasks.finish(task, "failed", e instanceof Error ? e.message : String(e));
      }
    }
    if (added) await this.plugin.persist();
    return added;
  }

  /**
   * Download the place data for the Map into the plugin's `places/` folder. A `.zip` is unpacked to a `.txt` of the same name and the
   * zip is dropped. Everything is read into memory and written with the vault adapter, so the files are the same on every platform.
   */
  async installPlaces(r: Resource): Promise<void> {
    if (!this.available) return void new Notice("Booker: downloads need the desktop app.");
    if (this.running.has(r.id)) return;
    const { io, pacer } = await this.engine();
    const abort = new AbortController();
    const tracker = this.plugin.tasks;
    const task = tracker.add(`Downloading ${r.title}`, { state: "running", total: r.files.length, cancel: () => abort.abort() });
    this.running.set(r.id, { task, abort });
    const a = this.plugin.app.vault.adapter;
    const dir = this.plugin.places.dir();
    try {
      if (!(await a.exists(dir))) await a.mkdir(dir);
      let n = 0;
      for (const f of r.files) {
        tracker.update(task, { done: n++, detail: f.to });
        const bytes = await fetchBytes(io, pacer, f.url, { signal: abort.signal, max: 400 * 1024 * 1024 });
        if (f.to.endsWith(".zip")) {
          const { default: JSZip } = await import("jszip");
          const zip = await JSZip.loadAsync(bytes);
          // the data file, not the readme that sits beside it
          const entry = Object.values(zip.files).find((e) => !e.dir && e.name.endsWith(".txt") && !/readme/i.test(e.name));
          if (!entry) throw new Error(`${f.to} has no data file in it`);
          const out = `${dir}/${f.to.replace(/\.zip$/, ".txt")}`;
          await a.writeBinary(out, (await entry.async("uint8array")).slice().buffer as ArrayBuffer);
        } else {
          await a.writeBinary(`${dir}/${f.to}`, bytes.slice().buffer as ArrayBuffer);
        }
      }
      this.plugin.places.reset();
      tracker.finish(task, "done", r.sizeNote ?? "");
    } catch (e) {
      if (e instanceof Cancelled || abort.signal.aborted) tracker.finish(task, "cancelled", "Cancelled");
      else tracker.finish(task, "failed", e instanceof Error ? e.message : String(e));
    } finally {
      this.running.delete(r.id);
    }
  }

  async removePlaces(r: Resource): Promise<void> {
    const a = this.plugin.app.vault.adapter;
    for (const f of r.files) {
      const p = `${this.plugin.places.dir()}/${f.to.replace(/\.zip$/, ".txt")}`;
      if (await a.exists(p)) await a.remove(p);
    }
    this.plugin.places.reset();
  }

  async remove(r: Resource): Promise<void> {
    if (!this.available) return;
    const { io } = await this.engine();
    await io.remove(this.absDir(r));
    await this.refresh(r);
  }

  /** Let the search and writing engines see a model that has just come or gone. */
  private async refresh(r: Resource) {
    if (r.kind === "model") await this.plugin.semantic.models(true);
    else if (r.kind === "gen") await this.plugin.gen.models(true);
  }
}
