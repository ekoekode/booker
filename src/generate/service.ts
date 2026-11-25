import type { App } from "obsidian";
import { createGenerator, type Generator } from "./generator";
import { GEN_DIR, parseGenInfo } from "./registry";
import type { GenInfo } from "./types";

/** Finds the installed writing models and keeps one open. Models come from the plugin folder; nothing is downloaded. */
export class GenService {
  private current: { id: string; gen: Promise<Generator> } | null = null;
  private listed: GenInfo[] | null = null;

  constructor(private app: App, private dir: () => string) {}

  async models(refresh = false): Promise<GenInfo[]> {
    if (this.listed && !refresh) return this.listed;
    const a = this.app.vault.adapter;
    const out: GenInfo[] = [];
    const root = `${this.dir()}/${GEN_DIR}`;
    try {
      if (await a.exists(root)) {
        for (const d of (await a.list(root)).folders) {
          try {
            const read = async (f: string) => ((await a.exists(`${d}/${f}`)) ? JSON.parse(await a.read(`${d}/${f}`)) : undefined);
            const info = parseGenInfo(await read("model.json"), await read("config.json"), await read("generation_config.json"));
            if (info && (await a.exists(`${d}/${info.file}`)) && (await a.exists(`${d}/tokenizer.json`))) out.push(info);
          } catch {
            /* not a model folder */
          }
        }
      }
    } catch {
      /* no folder */
    }
    return (this.listed = out.sort((x, y) => x.id.localeCompare(y.id)));
  }

  async generator(info: GenInfo): Promise<Generator> {
    if (this.current?.id === info.id) return this.current.gen;
    await this.close();
    const gen = createGenerator(this.app, this.dir(), info);
    this.current = { id: info.id, gen };
    gen.catch(() => {
      if (this.current?.gen === gen) this.current = null;
    });
    return gen;
  }

  async close() {
    const c = this.current;
    this.current = null;
    if (c) await c.gen.then((g) => g.dispose()).catch(() => undefined);
  }
}
