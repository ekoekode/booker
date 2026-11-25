import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import { loadNativeOrt, nativeRuntimeDir } from "./native";
import { MODELS_DIR } from "./registry";
import { runEncoded } from "./session";
import { TextTokenizer } from "./tokenize";
import type { Embedder, ModelInfo } from "./types";

/** Embeds with onnxruntime-node on the CPU. The fastest option by far on desktop. */
export async function createNativeEmbedder(app: App, pluginDir: string, info: ModelInfo): Promise<Embedder> {
  const a = app.vault.adapter;
  if (!(a instanceof FileSystemAdapter)) throw new Error("The native engine needs the desktop app.");
  const root = a.getBasePath();
  const ort = loadNativeOrt(`${root}/${nativeRuntimeDir(pluginDir)}`);
  const dir = `${pluginDir}/${MODELS_DIR}/${info.id}`;
  const tokenizer = new TextTokenizer(JSON.parse(await a.read(`${dir}/tokenizer.json`)), JSON.parse(await a.read(`${dir}/tokenizer_config.json`)), info.maxTokens);
  const session = await ort.InferenceSession.create(`${root}/${dir}/${info.file}`, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
  return {
    model: info.id,
    dim: info.dim,
    backend: "native",
    embed: (texts, progress) => runEncoded(ort, session, info, texts.map((t) => tokenizer.encode(t)), progress),
    dispose: async () => void (await session.release?.()),
  };
}
