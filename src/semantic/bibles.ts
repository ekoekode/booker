import type BookerPlugin from "../main";
import type { BibleModule, Hit } from "../scripture/module";
import { decodeVec, encodeVec, fingerprint, reuse } from "./vecfile";
import { VectorBlock } from "./vectors";

const SLICE = 256;
const SAVE_EVERY = 4096;

interface Verse {
  book: string;
  c: number;
  v: number;
  text: string;
}

/** Every verse of a module in canon order, as plain text. */
export function allVerses(mod: BibleModule): Verse[] {
  const out: Verse[] = [];
  for (const book of mod.books())
    for (let c = 1; c <= mod.chapterCount(book); c++)
      for (let v = 1; v <= mod.verseCount(book, c); v++) {
        const segs = mod.verse(book, c, v);
        const text = segs?.map((s) => s.t).join("").replace(/\s+/g, " ").trim();
        if (text) out.push({ book, c, v, text });
      }
  return out;
}

/** Searches a Bible by meaning. The vectors of its verses are made once and kept in a file beside the module. */
export class BibleSemantic {
  private held = new Map<string, { key: string; verses: Verse[]; block: VectorBlock }>();
  private running = new Map<string, Promise<{ verses: Verse[]; block: VectorBlock }>>();

  constructor(private plugin: BookerPlugin) {}

  private async ensure(path: string, mod: BibleModule, progress?: (msg: string) => void) {
    const info = await this.plugin.semanticIndex.model();
    if (!info) throw new Error("No semantic model is installed.");
    const key = `${path}:${info.id}:${info.version}`;
    const hit = this.held.get(path);
    if (hit && hit.key === key) return hit;
    const pending = this.running.get(key);
    if (pending) return pending;
    const p = (async () => {
      const verses = allVerses(mod);
      const fp = fingerprint(verses.map((x) => ({ loc: `${x.book}.${x.c}.${x.v}`, text: x.text })));
      const a = this.plugin.app.vault.adapter;
      const file = `${path}.vec`;
      let block = new VectorBlock(info.dim);
      try {
        if (await a.exists(file)) {
          const got = decodeVec(new Uint8Array(await a.readBinary(file)));
          const what = reuse(got?.header ?? null, info, fp, verses.length);
          if (got && what !== "restart") block = new VectorBlock(info.dim, got.data);
          if (what === "use") {
            const r = { key, verses, block };
            this.held.set(path, r);
            return r;
          }
        }
      } catch {
        /* made again */
      }
      const embedder = await this.plugin.semantic.embedder(info);
      const save = async () => {
        try {
          await a.writeBinary(file, encodeVec({ model: info.id, version: info.version, dim: info.dim, count: block.count, total: verses.length, fingerprint: fp }, block.bytes()).buffer as ArrayBuffer);
        } catch {
          /* still works from memory */
        }
      };
      let since = 0;
      for (let i = block.count; i < verses.length; i += SLICE) {
        const part = verses.slice(i, i + SLICE).map((x) => x.text);
        block = block.append(VectorBlock.from(info.dim, await embedder.embed(part)));
        since += part.length;
        progress?.(`Indexing ${mod.abbr || mod.name} for meaning… ${block.count} of ${verses.length}`);
        if (since >= SAVE_EVERY) {
          since = 0;
          await save();
        }
      }
      await save();
      const r = { key, verses, block };
      this.held.set(path, r);
      return r;
    })().finally(() => this.running.delete(key));
    this.running.set(key, p);
    return p;
  }

  /** The verses closest in meaning to the query, best first. */
  async search(path: string, mod: BibleModule, query: string, limit = 60, progress?: (msg: string) => void): Promise<Array<Hit & { score: number }>> {
    const info = await this.plugin.semanticIndex.model();
    if (!info) throw new Error("No semantic model is installed.");
    const idx = await this.ensure(path, mod, progress);
    const embedder = await this.plugin.semantic.embedder(info);
    const [q] = await embedder.embed([info.queryPrefix + query]);
    return idx.block.nearest(q, limit).map((h) => {
      const v = idx.verses[h.index];
      return { book: v.book, c: v.c, v: v.v, score: h.score } as Hit & { score: number };
    });
  }
}
