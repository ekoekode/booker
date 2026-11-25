import type { WebGLProbe } from "../project/mapRenderer";

export type { WebGLProbe };

/**
 * Can this machine draw WebGL, and is it real hardware WebGL? A context made with failIfMajorPerformanceCaveat is refused on
 * software renderers (virtual machines, blocklisted graphics cards), which is how "works but slow" is told apart from "works".
 * Kept apart from the MapLibre engine so the settings window can ask without loading it.
 */
export function probeWebGL(): WebGLProbe {
  try {
    const hard = document.createElement("canvas");
    if (hard.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) || hard.getContext("webgl", { failIfMajorPerformanceCaveat: true })) return "ok";
    const soft = document.createElement("canvas");
    return soft.getContext("webgl2") || soft.getContext("webgl") ? "software" : "none";
  } catch {
    return "none";
  }
}

/** Yes or no: is there any WebGL at all? */
export const hasWebGL = (): boolean => probeWebGL() !== "none";
