/** The writing models that ship as an optional pack in the plugin's models-gen folder. Pure parts. */
import type { GenInfo } from "./types";

export const GEN_DIR = "models-gen";

/** Joins model.json with the numbers in the model's own config.json and generation_config.json. Null when something needed is missing. */
export function parseGenInfo(modelJson: unknown, config: unknown, genConfig?: unknown): GenInfo | null {
  if (!modelJson || typeof modelJson !== "object" || !config || typeof config !== "object") return null;
  const m = modelJson as Record<string, unknown>;
  const c = config as Record<string, unknown>;
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const id = str(m.id).trim();
  const file = str(m.file).trim();
  if (!id || !file || /[\\/]/.test(id) || file.includes("..")) return null;
  const layers = num(c.num_hidden_layers);
  const heads = num(c.num_attention_heads);
  const kvHeads = num(c.num_key_value_heads) || heads;
  const hidden = num(c.hidden_size);
  if (!layers || !heads || !hidden) return null;
  const eosRaw = (genConfig as Record<string, unknown> | undefined)?.eos_token_id ?? c.eos_token_id;
  const eos = (Array.isArray(eosRaw) ? eosRaw : [eosRaw]).filter((x): x is number => typeof x === "number");
  if (!eos.length) return null;
  return {
    id,
    label: str(m.label, id),
    file,
    license: str(m.license),
    eos,
    layers,
    kvHeads,
    headDim: Math.round(hidden / heads),
    chunkWords: num(m.chunkWords) || 450,
    promptTokensPerSec: num(m.promptTokensPerSec) || 150,
    outputTokensPerSec: num(m.outputTokensPerSec) || 12,
  };
}
