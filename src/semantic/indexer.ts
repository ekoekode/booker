import type BookerPlugin from "../main";
import type { Result } from "../sources/service";
import type { Source } from "../sources/types";
import { decodeVec, encodeVec, fingerprint, reuse } from "./vecfile";
import { VectorBlock } from "./vectors";
import type { ModelInfo } from "./types";

const SAVE_EVERY = 1024;
const SLICE = 128;

const lead = (text: string, n = 240) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
};

/** Makes and keeps the vectors of each source, in a file beside it, and searches them by meaning. All on this computer. */
export class SemanticIndexer {
  private blocks = new Map<string, { key: string; block: VectorBlock }>();
  private running = new Map<string, Promise<VectorBlock>>();
  stopFlag = false;

  constructor(private plugin: BookerPlugin) {}

  vecPath(s: Source) {
    return `${s.file}.vec`;
  }

  async model(): Promise<ModelInfo | null> {
    return this.plugin.semantic.pick(this.plugin.scriptureData().semanticModel);
  }

  /** Whether any model is installed, so the Semantic choice can be offered. */
  async available(): Promise<boolean> {
    return !!(await this.model());
  }

  /** The vectors of a source: from memory, from its file, or made now (and saved). One job per source at a time. */
  async ensure(s: Source, progress?: (msg: string) => void): Promise<VectorBlock> {
    const info = await this.model();
    if (!info) throw new Error("No semantic model is installed.");
    const key = `${s.uid}:${info.id}:${info.version}`;
    const pending = this.running.get(key);
    if (pending) return pending;
    const p = this.build(s, info, key, progress).finally(() => this.running.delete(key));
    this.running.set(key, p);
    return p;
  }

  private async build(s: Source, info: ModelInfo, key: string, progress?: (msg: string) => void): Promise<VectorBlock> {
    const ix = await this.plugin.sourceService.index(s, progress);
    const chunks = ix.chunks;
    const fp = fingerprint(chunks);
    const mem = this.blocks.get(s.uid);
    if (mem && mem.key === `${key}:${fp}` && mem.block.count === chunks.length) return mem.block;
    const a = this.plugin.app.vault.adapter;
    const path = this.vecPath(s);
    let block = new VectorBlock(info.dim);
    try {
      if (await a.exists(path)) {
        const got = decodeVec(new Uint8Array(await a.readBinary(path)));
        const what = reuse(got?.header ?? null, info, fp, chunks.length);
        if (got && what !== "restart") block = new VectorBlock(info.dim, got.data);
        if (what === "use") {
          this.blocks.set(s.uid, { key: `${key}:${fp}`, block });
          return block;
        }
      }
    } catch {
      /* a damaged file is made again */
    }
    const embedder = await this.plugin.semantic.embedder(info);
    this.stopFlag = false;
    let sinceSave = 0;
    const save = async () => {
      const header = { model: info.id, version: info.version, dim: info.dim, count: block.count, total: chunks.length, fingerprint: fp };
      try {
        await a.writeBinary(path, encodeVec(header, block.bytes()).buffer as ArrayBuffer);
      } catch {
        /* the vectors still work from memory */
      }
    };
    for (let i = block.count; i < chunks.length; i += SLICE) {
      if (this.stopFlag) {
        await save();
        throw new Error("Stopped. Indexing continues from here next time.");
      }
      const part = chunks.slice(i, i + SLICE).map((c) => c.text);
      const vecs = await embedder.embed(part);
      block = block.append(VectorBlock.from(info.dim, vecs));
      sinceSave += part.length;
      progress?.(`Indexing ${s.title} for meaning… ${block.count} of ${chunks.length}`);
      if (sinceSave >= SAVE_EVERY) {
        sinceSave = 0;
        await save();
      }
    }
    await save();
    this.blocks.set(s.uid, { key: `${key}:${fp}`, block });
    return block;
  }

  /** The sources not switched off in Settings. */
  included(sources: Source[]): Source[] {
    const skip = new Set(this.plugin.scriptureData().semanticSkip ?? []);
    return skip.size ? sources.filter((s) => !skip.has(s.uid)) : sources;
  }

  /** Search the given sources by meaning. Sources not yet indexed are indexed now, once. */
  async search(sources: Source[], query: string, limit = 60, progress?: (msg: string) => void): Promise<Result[]> {
    const info = await this.model();
    if (!info) throw new Error("No semantic model is installed.");
    const embedder = await this.plugin.semantic.embedder(info);
    const [q] = await embedder.embed([info.queryPrefix + query]);
    const out: Result[] = [];
    for (const s of this.included(sources)) {
      let block: VectorBlock;
      try {
        block = await this.ensure(s, progress);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Stopped")) throw e;
        continue;
      }
      const ix = await this.plugin.sourceService.index(s);
      for (const h of block.nearest(q, limit)) {
        const c = ix.chunks[h.index];
        if (c) out.push({ source: s, chunk: c, chunkNo: h.index, snippet: lead(c.text), score: h.score });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Make the vectors of every source, one after another. */
  async indexAll(sources: Source[], progress?: (msg: string) => void, all = false, clearFirst = false): Promise<{ done: number; failed: number }> {
    let done = 0;
    let failed = 0;
    this.stopFlag = false;
    const todo = all ? sources : this.included(sources);
    const task = this.plugin.tasks.add(clearFirst ? "Regenerating meaning indexes" : "Indexing for search by meaning", { state: "running", total: todo.length, cancel: () => (this.stopFlag = true) });
    for (const s of todo) {
      if (this.stopFlag) break;
      this.plugin.tasks.update(task, { detail: s.title, done });
      if (clearFirst) await this.clear(s);
      try {
        await this.ensure(s, (m) => {
          this.plugin.tasks.update(task, { detail: `${s.title}: ${m}` });
          progress?.(m);
        });
        done++;
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Stopped")) break;
        failed++;
      }
    }
    this.plugin.tasks.finish(task, this.stopFlag ? "cancelled" : "done", `${done} done${failed ? `, ${failed} could not be read` : ""}`);
    return { done, failed };
  }

  /** How much of a source is indexed, read from its file's header: "none", a count so far, or "done". */
  async status(s: Source): Promise<{ state: "none" | "partial" | "done"; count: number; total: number }> {
    try {
      const a = this.plugin.app.vault.adapter;
      const path = this.vecPath(s);
      if (!(await a.exists(path))) return { state: "none", count: 0, total: 0 };
      const got = decodeVec(new Uint8Array(await a.readBinary(path)));
      if (!got) return { state: "none", count: 0, total: 0 };
      const { count, total } = got.header;
      return { state: count >= total ? "done" : "partial", count, total };
    } catch {
      return { state: "none", count: 0, total: 0 };
    }
  }

  /** Throw away the vectors of a source, in memory and on disk. */
  async clear(s: Source) {
    this.blocks.delete(s.uid);
    const a = this.plugin.app.vault.adapter;
    const path = this.vecPath(s);
    try {
      if (await a.exists(path)) await a.remove(path);
    } catch {
      /* nothing to remove */
    }
  }

  /** Forget what is held for a source (its file changed or it was removed). */
  forget(uid: string) {
    this.blocks.delete(uid);
  }
}
