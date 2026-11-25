import type { ExportOptions } from "./headings";

/** Named sets of export settings, kept in the plugin's data. Pure; the modal does the saving. */
export type SavedPresets = Record<string, Partial<ExportOptions>>;

export function presetName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

export function presetNames(p: SavedPresets | undefined): string[] {
  return Object.keys(p ?? {}).sort((a, b) => a.localeCompare(b));
}

/** The presets with `name` saved (replacing a same-named one, ignoring case). */
export function savePreset(p: SavedPresets | undefined, name: string, opts: ExportOptions): SavedPresets {
  const clean = presetName(name);
  const out: SavedPresets = {};
  for (const [k, v] of Object.entries(p ?? {})) if (k.toLowerCase() !== clean.toLowerCase()) out[k] = v;
  out[clean] = { ...opts };
  return out;
}

export function deletePreset(p: SavedPresets | undefined, name: string): SavedPresets {
  const out: SavedPresets = {};
  for (const [k, v] of Object.entries(p ?? {})) if (k !== name) out[k] = v;
  return out;
}

/** Options with a preset laid over them; settings the preset lacks keep their current value. */
export function applyPreset(current: ExportOptions, preset: Partial<ExportOptions> | undefined): ExportOptions {
  return { ...current, ...(preset ?? {}) };
}
