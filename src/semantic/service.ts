import type { App } from "obsidian";
import { createNativeEmbedder } from "./embedder";
import { MODELS_DIR, parseModelInfo, pickModel } from "./registry";
import type { Embedder, ModelInfo } from "./types";

/** Finds the installed models and keeps one embedder open. Makes no network calls: models and runtime come from the plugin folder. */
export class SemanticService {
  private current: { id: string; embedder: Promise<Embedder> } | null = null;
  private listed: ModelInfo[] | null = null;

  constructor(private app: App, private dir: () => string) {}

  /** Models found in <plugin>/models, each with a model.json. */
  async models(refresh = false): Promise<ModelInfo[]> {
    if (this.listed && !refresh) return this.listed;
    const a = this.app.vault.adapter;
    const out: ModelInfo[] = [];
    const root = `${this.dir()}/${MODELS_DIR}`;
    try {
      if (await a.exists(root)) {
        for (const d of (await a.list(root)).folders) {
          try {
            const info = parseModelInfo(JSON.parse(await a.read(`${d}/model.json`)));
            if (info && (await a.exists(`${d}/${info.file}`)) && (await a.exists(`${d}/tokenizer.json`))) out.push(info);
          } catch {
            /* a folder without a good model.json is not a model */
          }
        }
      }
    } catch {
      /* no models folder */
    }
    return (this.listed = out.sort((x, y) => x.id.localeCompare(y.id)));
  }

  async pick(wanted: string | undefined): Promise<ModelInfo | null> {
    return pickModel(await this.models(), wanted);
  }

  /** The embedder for a model, opened once. Throws a plain reason when no engine can run it. */
  async embedder(info: ModelInfo): Promise<Embedder> {
    if (this.current?.id === info.id) return this.current.embedder;
    await this.close();
    const p = createNativeEmbedder(this.app, this.dir(), info);
    this.current = { id: info.id, embedder: p };
    p.catch(() => {
      if (this.current?.embedder === p) this.current = null;
    });
    return p;
  }

  async close() {
    const c = this.current;
    this.current = null;
    if (c) await c.embedder.then((e) => e.dispose()).catch(() => undefined);
  }
}
