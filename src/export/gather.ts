import type { Manuscript } from "./model";


export interface Gathered {
  manuscript: Manuscript;
  cover: { data: ArrayBuffer; ext: string } | null;
  skippedScenes: number;
  includedScenes: number;
  /** [@key] citations that matched no source, left as typed in the export */
  unknownCitations?: string[];
}

/** Deterministic UUID-ish id from a string, so re-exports keep the same ebook identifier. */
export function uuid(seed: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < seed.length; i++) {
      const ch = seed.charCodeAt(i) + k;
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    out.push(((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")).slice(0, 8));
  }
  const hex = out.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}


export type { ExportOptions, Preset, ChapterStyle } from "./headings";
export { chapterHeading, actHeading } from "./headings";
