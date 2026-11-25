/**
 * Finds the Strong's number under each English word of every Bible you have, in the background, and keeps the result beside the Berean
 * word-for-word data (one small file per book per Bible). A Bible that already tags its words is read as it is; any other is matched
 * with the Berean English. The word study uses the result to pick out a word exactly in whichever translation is chosen.
 */
import { normalizePath } from "obsidian";
import type BookerPlugin from "../main";
import { ALIGN_VERSION, alignVerse, learn, Lexicon, type AlignBook } from "./align";
import { BOOKS } from "./books";
import type { IBook } from "./interlinear";
import { plain, type BibleModule } from "./module";
import type { ModuleFile } from "./store";
import { taggedSpans } from "./tagged";

interface Meta {
  v: number;
  size: number;
  mtime: number;
  /** a Bible that cannot be matched (not English), noted so it is not tried at every start */
  skipped?: string;
}

const safe = (path: string) => path.replace(/[^\w.-]+/g, "_");
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

/** The common English words are most of the text of an English Bible and a small part of any other. */
function looksEnglish(mod: BibleModule): boolean {
  let all = 0;
  let common = 0;
  const book = mod.books().includes("John") ? "John" : mod.books()[0];
  for (let v = 1; v <= Math.min(40, mod.verseCount(book, 1)); v++) {
    for (const w of plain(mod.verse(book, 1, v) ?? []).toLowerCase().match(/[a-z']+/g) ?? []) {
      all++;
      if (/^(the|and|of|to|in|that|is|was|he|his|in|for|with)$/.test(w)) common++;
    }
  }
  return all > 20 && common / all > 0.15;
}

export class Aligner {
  private jobs = new Map<string, Promise<void>>();
  private chain: Promise<void> = Promise.resolve();
  private cache = new Map<string, Promise<AlignBook | null>>();
  private status = new Map<string, Promise<Meta | null>>();

  constructor(private plugin: BookerPlugin) {}

  private get adapter() {
    return this.plugin.app.vault.adapter;
  }
  private dir(file: ModuleFile) {
    return normalizePath(`${this.plugin.resources.wordStudyDir()}/align/${safe(file.path)}`);
  }

  private async stamp(file: ModuleFile): Promise<{ size: number; mtime: number }> {
    const s = await this.adapter.stat(file.path);
    return { size: s?.size ?? 0, mtime: s?.mtime ?? 0 };
  }

  /** What was recorded for this Bible if it is still the file and the matching that were used. */
  private meta(file: ModuleFile): Promise<Meta | null> {
    let p = this.status.get(file.path);
    if (!p) {
      p = (async () => {
        try {
          const f = `${this.dir(file)}/meta.json`;
          if (!(await this.adapter.exists(f))) return null;
          const m = JSON.parse(await this.adapter.read(f)) as Meta;
          const now = await this.stamp(file);
          return m.v === ALIGN_VERSION && m.size === now.size && m.mtime === now.mtime ? m : null;
        } catch {
          return null;
        }
      })();
      this.status.set(file.path, p);
    }
    return p;
  }

  /** Whether this Bible has been matched (or cannot be). */
  async current(file: ModuleFile): Promise<boolean> {
    return !!(await this.meta(file));
  }

  /** The matches for one book of a Bible, or null when there are none (yet). */
  book(file: ModuleFile, osis: string): Promise<AlignBook | null> {
    const key = `${file.path}|${osis}`;
    let p = this.cache.get(key);
    if (!p) {
      p = (async () => {
        const m = await this.meta(file);
        if (!m || m.skipped) return null;
        try {
          const f = `${this.dir(file)}/${osis}.json`;
          return (await this.adapter.exists(f)) ? (JSON.parse(await this.adapter.read(f)) as AlignBook) : null;
        } catch {
          return null;
        }
      })();
      this.cache.set(key, p);
      while (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  /** Whether a Bible is waiting to be matched or being matched. */
  busy(file: ModuleFile): boolean {
    return this.jobs.has(file.path);
  }

  /** Match a Bible in the background unless it has been matched already. Resolves when it is done; Bibles are taken one at a time. */
  ensure(file: ModuleFile): Promise<void> {
    const had = this.jobs.get(file.path);
    if (had) return had;
    const job = (async () => {
      if (await this.current(file)) return;
      if (!(await this.plugin.wordData.available())) return;
      await (this.chain = this.chain.then(() => this.run(file)).catch(() => undefined));
    })().finally(() => {
      this.jobs.delete(file.path);
      this.status.delete(file.path);
      for (const k of [...this.cache.keys()]) if (k.startsWith(`${file.path}|`)) this.cache.delete(k);
    });
    this.jobs.set(file.path, job);
    return job;
  }

  /** Every Bible in the library. */
  async ensureAll(): Promise<void> {
    if (!(await this.plugin.wordData.available())) return;
    for (const f of await this.plugin.modules.bibles()) void this.ensure(f);
  }

  private async words(osis: string): Promise<IBook | null> {
    const f = normalizePath(`${this.plugin.resources.wordStudyDir()}/${osis}.json`);
    try {
      return (await this.adapter.exists(f)) ? (JSON.parse(await this.adapter.read(f)) as IBook) : null;
    } catch {
      return null;
    }
  }

  private async save(file: ModuleFile, osis: string, data: AlignBook) {
    await this.adapter.write(`${this.dir(file)}/${osis}.json`, JSON.stringify(data));
  }

  private async mkdirs(dir: string) {
    let cur = "";
    for (const part of dir.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.adapter.exists(cur))) await this.adapter.mkdir(cur);
    }
  }

  private async run(file: ModuleFile): Promise<void> {
    const plugin = this.plugin;
    const title = await plugin.modules.title(file);
    const abort = new AbortController();
    const task = plugin.tasks.add(`Matching words to Strong's numbers in ${title}`, { state: "running", cancel: () => abort.abort() });
    const stop = () => {
      if (abort.signal.aborted) throw new Error("Cancelled");
    };
    try {
      await this.mkdirs(this.dir(file));
      const stamp = await this.stamp(file);
      const mod = await plugin.modules.load(file);
      const canon = BOOKS.filter((b) => !b.extra && mod.books().includes(b.osis));
      plugin.tasks.update(task, { total: canon.length });
      if (!mod.hasStrongs?.() && !looksEnglish(mod)) {
        await this.adapter.write(`${this.dir(file)}/meta.json`, JSON.stringify({ v: ALIGN_VERSION, ...stamp, skipped: "not English" } satisfies Meta));
        return void plugin.tasks.finish(task, "skipped", "Not an English Bible");
      }
      const native = !!mod.hasStrongs?.();
      const lex = new Lexicon();
      let verses = 0;
      let matched = 0;
      // a Bible without tags is read twice: the first time to learn how it words each number, the second to match with that
      for (const pass of native ? [1] : [0, 1]) {
        plugin.tasks.update(task, { done: 0, detail: pass ? "Matching" : "Learning how this Bible words each number" });
        let done = 0;
        for (const b of canon) {
          stop();
          const words = native ? null : await this.words(b.osis);
          if (!native && !words) {
            plugin.tasks.update(task, { done: ++done });
            continue;
          }
          const out: AlignBook = {};
          for (let c = 1; c <= mod.chapterCount(b.osis); c++) {
            for (let v = 1; v <= mod.verseCount(b.osis, c); v++) {
              if (native) {
                const t = taggedSpans(mod.rawVerse?.(b.osis, c, v) ?? "");
                if (t?.spans.length) ((out[c] ??= {})[v] = t.spans);
                continue;
              }
              const w = words![c]?.[v];
              const segs = mod.verse(b.osis, c, v);
              if (!w || !segs) continue;
              const text = plain(segs);
              const spans = alignVerse(w, text, pass ? lex : undefined);
              if (!pass) learn(lex, text, spans);
              else if (spans.length) {
                (out[c] ??= {})[v] = spans;
                verses++;
                matched += spans.length;
              }
            }
            await breathe();
          }
          if (pass) {
            if (native) verses += Object.values(out).reduce((n, ch) => n + Object.keys(ch).length, 0);
            await this.save(file, b.osis, out);
          }
          plugin.tasks.update(task, { done: ++done, detail: `${pass ? "Matching" : "Learning"} ${b.name}` });
        }
      }
      await this.adapter.write(`${this.dir(file)}/meta.json`, JSON.stringify({ v: ALIGN_VERSION, ...stamp } satisfies Meta));
      plugin.tasks.finish(task, "done", native ? `${verses} verses read from the Bible's own tags` : `${verses} verses, ${matched} words matched`);
    } catch (e) {
      if (abort.signal.aborted) plugin.tasks.finish(task, "cancelled", "Cancelled");
      else plugin.tasks.finish(task, "failed", e instanceof Error ? e.message : String(e));
    }
  }
}
