import { TFile } from "obsidian";
import type BookerPlugin from "../main";
import { findProjects } from "../project/vaultOps";
import type { SearchMode } from "../sources/fuzzy";
import { extractText } from "../sources/extract";
import { buildIndex, search as searchWords, snippet, type SourceIndex } from "../sources/index";
import type { Chunk } from "../sources/types";
import { fuse } from "./hybrid";
import { planFiles, type FileStamp } from "./writingPlan";
import { decodeVec, encodeVec } from "./vecfile";
import { VectorBlock } from "./vectors";

export interface WritingHit {
  path: string;
  title: string;
  loc: string;
  snippet: string;
  score: number;
}

interface Rec extends FileStamp {
  chunks: Chunk[];
  /** vectors of the chunks, made on the first meaning search */
  vecs?: Int8Array;
}

interface Meta {
  model: string;
  version: number;
  files: Array<FileStamp & { count: number }>;
}

/** Everything you have written in your projects (scenes, notes, Codex), searchable by words and by meaning.
 *  Notes are read again only when they change. Vectors are kept in the plugin folder. */
export class WritingIndex {
  private recs = new Map<string, Rec>();
  private loaded = false;
  private all: { chunks: Array<Chunk & { path: string }>; ix: SourceIndex } | null = null;
  private block: VectorBlock | null = null;
  private blockFor = "";

  constructor(private plugin: BookerPlugin) {}

  private get dir() {
    return `${this.plugin.manifest.dir}/semantic`;
  }

  /** Every Markdown note inside a project's folder, except snapshots. */
  private files(): TFile[] {
    const roots = [...new Set(findProjects(this.plugin.app).map((p) => p.file.parent?.path ?? ""))].filter(Boolean);
    // safety snapshots of a scene are copies of it: searching them would list every scene twice
    return this.plugin.app.vault.getMarkdownFiles().filter((f) => roots.some((r) => f.path.startsWith(`${r}/`)) && !f.path.includes("/System/snapshots/"));
  }

  /** Brings the pieces up to date with the notes. Returns how many notes were read again. */
  async refresh(progress?: (msg: string) => void): Promise<number> {
    const app = this.plugin.app;
    if (!this.loaded) await this.loadSaved();
    const files = this.files();
    const plan = planFiles([...this.recs.values()], files.map((f) => ({ path: f.path, mtime: f.stat.mtime, size: f.stat.size })));
    for (const p of plan.removed) this.recs.delete(p);
    let n = 0;
    for (const path of plan.changed) {
      const f = files.find((x) => x.path === path)!;
      const text = await app.vault.cachedRead(f);
      const chunks = extractText(text, true).filter((c) => c.text.trim().length > 20);
      this.recs.set(path, { path, mtime: f.stat.mtime, size: f.stat.size, chunks });
      if (++n % 40 === 0) {
        progress?.(`Reading your notes… ${n} of ${plan.changed.length}`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (plan.removed.length || plan.changed.length || !this.all) this.rebuild(files);
    return n;
  }

  private rebuild(files: TFile[]) {
    const chunks: Array<Chunk & { path: string }> = [];
    for (const f of files) for (const c of this.recs.get(f.path)?.chunks ?? []) chunks.push({ ...c, path: f.path });
    this.all = { chunks, ix: buildIndex(chunks) };
    this.block = null;
  }

  /** Vectors for every piece, made for the pieces that have none. */
  private async vectors(progress?: (msg: string) => void): Promise<VectorBlock | null> {
    const info = await this.plugin.semanticIndex.model();
    if (!info || !this.all) return null;
    const key = `${info.id}:${info.version}:${this.all.chunks.length}`;
    if (this.block && this.blockFor === key) return this.block;
    const embedder = await this.plugin.semantic.embedder(info);
    const order = [...new Set(this.all.chunks.map((c) => c.path))];
    let total = 0;
    for (const p of order) total += this.recs.get(p)!.chunks.length;
    let done = 0;
    let dirty = false;
    for (const p of order) {
      const rec = this.recs.get(p)!;
      if (!rec.vecs || rec.vecs.length !== rec.chunks.length * info.dim) {
        const vs = await embedder.embed(rec.chunks.map((c) => c.text));
        rec.vecs = VectorBlock.from(info.dim, vs).bytes();
        dirty = true;
      }
      done += rec.chunks.length;
      progress?.(`Indexing your writing for meaning… ${done} of ${total}`);
    }
    let block = new VectorBlock(info.dim);
    for (const p of order) block = block.append(new VectorBlock(info.dim, this.recs.get(p)!.vecs!));
    this.block = block;
    this.blockFor = key;
    if (dirty) await this.save(info.id, info.version, info.dim, order);
    return block;
  }

  private async save(model: string, version: number, dim: number, order: string[]) {
    const a = this.plugin.app.vault.adapter;
    try {
      if (!(await a.exists(this.dir))) await a.mkdir(this.dir);
      const files = order.map((p) => {
        const r = this.recs.get(p)!;
        return { path: p, mtime: r.mtime, size: r.size, count: r.chunks.length };
      });
      let data = new Int8Array(0);
      for (const p of order) {
        const v = this.recs.get(p)!.vecs!;
        const next = new Int8Array(data.length + v.length);
        next.set(data);
        next.set(v, data.length);
        data = next;
      }
      const meta: Meta = { model, version, files };
      await a.write(`${this.dir}/writing.json`, JSON.stringify(meta));
      await a.writeBinary(`${this.dir}/writing.vec`, encodeVec({ model, version, dim, count: files.reduce((s, f) => s + f.count, 0), total: files.reduce((s, f) => s + f.count, 0), fingerprint: "writing" }, data).buffer as ArrayBuffer);
    } catch {
      /* vectors still work from memory */
    }
  }

  /** Reads what was saved, for notes that have not changed. The pieces themselves are made again from the notes. */
  private async loadSaved() {
    this.loaded = true;
    const a = this.plugin.app.vault.adapter;
    try {
      if (!(await a.exists(`${this.dir}/writing.json`)) || !(await a.exists(`${this.dir}/writing.vec`))) return;
      const meta = JSON.parse(await a.read(`${this.dir}/writing.json`)) as Meta;
      const info = await this.plugin.semanticIndex.model();
      const vec = decodeVec(new Uint8Array(await a.readBinary(`${this.dir}/writing.vec`)));
      if (!info || !vec || meta.model !== info.id || meta.version !== info.version || vec.header.dim !== info.dim) return;
      let at = 0;
      for (const f of meta.files) {
        const len = f.count * info.dim;
        this.pendingVecs.set(f.path, { stamp: f, vecs: vec.data.slice(at, at + len) });
        at += len;
      }
    } catch {
      /* nothing usable saved */
    }
  }

  private pendingVecs = new Map<string, { stamp: FileStamp & { count: number }; vecs: Int8Array }>();

  /** Search your writing. Words (exact or fuzzy) always; meaning too when asked and a model is installed. */
  async search(query: string, mode: SearchMode, limit = 60, progress?: (msg: string) => void): Promise<WritingHit[]> {
    await this.refresh(progress);
    // give saved vectors back to notes that have not changed
    for (const [p, v] of this.pendingVecs) {
      const r = this.recs.get(p);
      if (r && r.mtime === v.stamp.mtime && r.size === v.stamp.size && r.chunks.length === v.stamp.count) r.vecs = v.vecs;
    }
    this.pendingVecs.clear();
    const all = this.all;
    if (!all) return [];
    const word = searchWords(all.ix, query, limit, mode === "exact" ? "exact" : "fuzzy").map((h) => ({ i: h.chunk, score: h.score }));
    let ranked = word;
    if (mode === "semantic") {
      try {
        const block = await this.vectors(progress);
        const info = await this.plugin.semanticIndex.model();
        if (block && info) {
          const embedder = await this.plugin.semantic.embedder(info);
          const [q] = await embedder.embed([info.queryPrefix + query]);
          const meaning = block.nearest(q, limit).map((h) => ({ i: h.index, score: h.score }));
          ranked = fuse([{ items: word, weight: 0.7 }, { items: meaning }], (x) => String(x.i)).map((x) => ({ i: x.item.i, score: x.score }));
        }
      } catch {
        /* words only */
      }
    }
    return ranked.slice(0, limit).map((r) => {
      const c = all.chunks[r.i];
      return { path: c.path, title: c.path.split("/").pop()!.replace(/\.md$/, ""), loc: c.loc, snippet: mode === "semantic" ? snippetOf(c.text) : snippet(c.text, query), score: r.score };
    });
  }
}

const snippetOf = (text: string, n = 240) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
};
