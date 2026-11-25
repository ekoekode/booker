/** onnxruntime-node, loaded from the plugin's own runtime folder. Desktop only; if it is missing or will not load, the caller falls back. */
import type { OrtLike, SessionLike } from "./session";

export interface NativeOrt extends OrtLike {
  InferenceSession: { create(path: string, opts?: Record<string, unknown>): Promise<SessionLike & { release?(): Promise<void> }> };
}

export const platformKey = (platform: string = process.platform, arch: string = process.arch) => `${platform}-${arch}`;

/** Where the runtime for this machine sits inside the plugin folder, or null when it is not one the plugin ships. */
export function nativeRuntimeDir(pluginDir: string, platform?: string, arch?: string): string {
  return `${pluginDir}/runtime/${platformKey(platform, arch)}/node_modules/onnxruntime-node`;
}

let loaded: { dir: string; ort: NativeOrt } | null = null;

/** `absDir` is the absolute path of the onnxruntime-node folder. Throws with a plain reason when it cannot load. */
export function loadNativeOrt(absDir: string): NativeOrt {
  if (loaded?.dir === absDir) return loaded.ort;
  const req = (globalThis as any).require ?? (typeof window !== "undefined" ? (window as any).require : undefined);
  if (typeof req !== "function") throw new Error("This device cannot run the native engine (not the desktop app).");
  let ort: NativeOrt;
  try {
    ort = req(absDir) as NativeOrt;
  } catch (e) {
    throw new Error(`The native engine for this computer is not installed or would not load. ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
  loaded = { dir: absDir, ort };
  return ort;
}
