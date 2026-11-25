/**
 * Which drawing engine the real-world map uses. Pure.
 * "webgl" is MapLibre: smooth and fast, but it needs working WebGL. "compatible" is Leaflet on a canvas: it runs anywhere.
 * Custom (picture) maps always use the compatible engine, which suits flat images better.
 */

export type RendererSetting = "auto" | "webgl" | "compatible";
export type RendererChoice = "webgl" | "compatible";

/** What the computer offers, from probing for a WebGL context. */
export type WebGLProbe = "ok" | "software" | "none";

export const RENDERER_SETTINGS: RendererSetting[] = ["auto", "webgl", "compatible"];

export const parseRenderer = (v: unknown): RendererSetting => (v === "webgl" || v === "compatible" ? v : "auto");

/**
 * Auto picks WebGL only when it is real hardware WebGL. Software rendering (a virtual machine, a blocklisted graphics card) works but is
 * slow, so Auto falls back. A forced "webgl" is honoured whenever any WebGL exists, and falls back only when there is none.
 */
export function chooseRenderer(setting: RendererSetting, probe: WebGLProbe): RendererChoice {
  if (setting === "compatible") return "compatible";
  if (probe === "none") return "compatible";
  if (setting === "webgl") return "webgl";
  return probe === "ok" ? "webgl" : "compatible";
}

/** A sentence for the settings window. */
export function probeText(probe: WebGLProbe): string {
  if (probe === "ok") return "This computer: WebGL is available.";
  if (probe === "software") return "This computer: WebGL runs in software only, which is slow.";
  return "This computer: WebGL is not available.";
}

/** Why the compatible engine is in use, for the one-line notice on the map. */
export function whyCompatible(setting: RendererSetting, probe: WebGLProbe, failed = false): string {
  if (failed) return "The WebGL map failed, so the compatible map is shown.";
  if (setting === "compatible") return "Compatible map (set in Maps settings).";
  if (probe === "none") return "WebGL is not available here, so the compatible map is shown.";
  return "WebGL is software-only here, so the compatible map is shown.";
}
