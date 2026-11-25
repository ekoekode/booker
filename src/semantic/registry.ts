/** The models that ship in the plugin's models folder. Nothing is downloaded: a model is a folder someone put there. */
import type { ModelInfo, Pooling } from "./types";

export const MODELS_DIR = "models";
export const DEFAULT_MODEL = "bge-micro-v2";

/** Reads a model.json, filling anything missing with safe values. Null when it names no model or file. */
export function parseModelInfo(raw: unknown): ModelInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : d);
  const id = str(o.id).trim();
  const file = str(o.file).trim();
  if (!id || !file || /[\\/]/.test(id) || /\.\./.test(file)) return null;
  const pooling: Pooling = o.pooling === "cls" ? "cls" : "mean";
  return { id, label: str(o.label, id), dim: num(o.dim, 384), pooling, maxTokens: num(o.maxTokens, 256), queryPrefix: str(o.queryPrefix), file, license: str(o.license), version: num(o.version, 1) };
}

/** The model to use: the one asked for if it is installed, else the default, else the first. */
export function pickModel(installed: ModelInfo[], wanted: string | undefined): ModelInfo | null {
  return installed.find((m) => m.id === wanted) ?? installed.find((m) => m.id === DEFAULT_MODEL) ?? installed[0] ?? null;
}
