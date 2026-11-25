/** Builds and keeps the search index of each source, and searches across sources. */
import type { SearchMode } from "./fuzzy";
import { nlibChunks, readDatabase, type NlibEntry } from "./nlib";
import { applyNav, mapPath, parseMap, type DbMap } from "./dbmap";
import { App, loadPdfJs } from "obsidian";
import { buildIndex, search as searchIndex, snippet, type SourceIndex } from "./index";
import { extractEpub, extractHtml, extractPages, extractText, extractXmlText } from "./extract";
import type { Chunk, Source } from "./types";

const tick = () => new Promise<void>((r) => window.setTimeout(r, 0));

interface Stored {
  mtime: number;
  size: number;
  /** what the file was read as, so a copy made before it was recognised is rebuilt */
  kind?: string;
  index: SourceIndex;
}

export interface Result {
  source: Source;
  chunk: Chunk;
  chunkNo: number;
  snippet: string;
  score: number;
}

export class SourceService {
  private mem = new Map<string, SourceIndex>();
  private building = new Map<string, Promise<SourceIndex>>();

  constructor(private app: App, private dir: () => string) {}

  private cacheFile(s: Source) {
    return `${this.dir()}/sources/${s.uid}.json`;
  }

  /** The index for a source: from memory, then the saved copy if the file has not changed, else built now. */
  async index(s: Source, progress?: (msg: string) => void): Promise<SourceIndex> {
    const hit = this.mem.get(s.uid);
    if (hit) return hit;
    const pending = this.building.get(s.uid);
    if (pending) return pending;
    const p = this.load(s, progress).finally(() => this.building.delete(s.uid));
    this.building.set(s.uid, p);
    const ix = await p;
    this.mem.set(s.uid, ix);
    while (this.mem.size > 12) this.mem.delete(this.mem.keys().next().value!);
    return ix;
  }

  private async load(s: Source, progress?: (msg: string) => void): Promise<SourceIndex> {
    const a = this.app.vault.adapter;
    const st = await a.stat(s.file);
    if (!st) throw new Error(`The file for “${s.title}” is missing: ${s.file}`);
    const cache = this.cacheFile(s);
    try {
      if (await a.exists(cache)) {
        const raw = await a.read(cache);
        // a database that was once read as plain text left its raw bytes in the index: drop it without parsing the (huge) file
        if (s.kind === "db" && raw.slice(0, 3000).includes("SQLite format 3")) throw new Error("index of the raw file");
        const stored = JSON.parse(raw) as Stored;
        if (stored.mtime === st.mtime && stored.size === st.size && stored.index?.v === 1) return stored.index;
      }
    } catch {
      /* a damaged cache is rebuilt */
    }
    progress?.(`Indexing ${s.title}…`);
    const chunks = await this.extract(s, progress);
    const index = buildIndex(chunks);
    try {
      const dir = `${this.dir()}/sources`;
      if (!(await a.exists(dir))) await a.mkdir(dir);
      await a.write(cache, JSON.stringify({ mtime: st.mtime, size: st.size, kind: s.kind, index } satisfies Stored));
    } catch {
      /* the index still works from memory */
    }
    return index;
  }

  async extract(s: Source, progress?: (msg: string) => void): Promise<Chunk[]> {
    const a = this.app.vault.adapter;
    switch (s.kind) {
      case "pdf": {
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await a.readBinary(s.file)) }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const tc = await page.getTextContent();
          let text = "";
          let lastY: number | null = null;
          for (const it of tc.items as Array<{ str: string; transform: number[]; hasEOL?: boolean }>) {
            const y = it.transform[5];
            if (lastY !== null && Math.abs(y - lastY) > 14) text += "\n\n";
            else if (text && !text.endsWith(" ") && !text.endsWith("\n")) text += " ";
            text += it.str;
            lastY = y;
          }
          pages.push(text);
          if (i % 10 === 0) {
            progress?.(`${s.title}: page ${i} of ${doc.numPages}`);
            await tick();
          }
        }
        return extractPages(pages);
      }
      case "epub":
        return (await extractEpub(await a.readBinary(s.file))).chunks;
      case "html":
        return extractHtml(await a.read(s.file));
      case "db": {
        const { entries } = await readDatabase(new Uint8Array(await a.readBinary(s.file)), s.title, await this.mapOf(s));
        return nlibChunks(entries);
      }
      case "xml":
        return extractXmlText(await a.read(s.file));
      case "md":
        return extractText(await a.read(s.file), true);
      default:
        return extractText(await a.read(s.file), false);
    }
  }

  private dbs = new Map<string, NlibEntry[]>();

  /** The entries of a reference library, in reading order, for browsing. */
  async entries(s: Source): Promise<NlibEntry[]> {
    const hit = this.dbs.get(s.uid);
    if (hit) return hit;
    const map = await this.mapOf(s);
    const { entries: all } = await readDatabase(new Uint8Array(await this.app.vault.adapter.readBinary(s.file)), s.title, map);
    const entries = map ? applyNav(all, map.nav) : all;
    this.dbs.set(s.uid, entries);
    while (this.dbs.size > 4) this.dbs.delete(this.dbs.keys().next().value!);
    return entries;
  }

  /** The field mapping saved next to a database, if there is one. */
  async mapOf(s: Source): Promise<DbMap | null> {
    const a = this.app.vault.adapter;
    const p = mapPath(s.file);
    try {
      return (await a.exists(p)) ? parseMap(await a.read(p)) : null;
    } catch {
      return null;
    }
  }

  async saveMap(s: Source, map: DbMap) {
    await this.app.vault.adapter.write(mapPath(s.file), JSON.stringify(map, null, 2));
    this.forget(s.uid);
    try {
      await this.app.vault.adapter.remove(this.cacheFile(s));
    } catch {
      /* no cached index yet */
    }
  }

  forget(uid: string) {
    this.mem.delete(uid);
    this.dbs.delete(uid);
  }

  /** Search the given sources (all by default). Slow sources are indexed on the way; `progress` says which. */
  async search(sources: Source[], query: string, limit = 60, progress?: (msg: string) => void, mode: SearchMode = "exact"): Promise<Result[]> {
    const out: Result[] = [];
    for (const s of sources) {
      let ix: SourceIndex;
      try {
        ix = await this.index(s, progress);
      } catch {
        continue;
      }
      for (const h of searchIndex(ix, query, limit, mode)) {
        const c = ix.chunks[h.chunk];
        out.push({ source: s, chunk: c, chunkNo: h.chunk, snippet: snippet(c.text, query), score: h.score });
      }
      await tick();
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Build every missing index in the background, one source at a time. */
  async indexAll(sources: Source[], progress?: (msg: string) => void) {
    for (const s of sources) {
      try {
        await this.index(s, progress);
      } catch {
        /* reported when the source is searched or opened */
      }
      await tick();
    }
  }
}
