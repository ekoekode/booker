/** Cutting a long text into pieces the model can summarise, and saying how long that will take. Pure. */
import { splitSentences } from "../semantic/summary";

const words = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Pieces of about `maxWords` words, cut between sentences, in reading order. A sentence is never split. */
export function chunkText(text: string, maxWords = 450): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let n = 0;
  for (const s of splitSentences(text, 1)) {
    const w = words(s);
    if (buf.length && n + w > maxWords) {
      out.push(buf.join(" "));
      buf = [];
      n = 0;
    }
    buf.push(s);
    n += w;
  }
  if (buf.length) out.push(buf.join(" "));
  return out;
}

export interface Rate {
  promptTokensPerSec: number;
  outputTokensPerSec: number;
}

const TOKENS_PER_WORD = 1.5;
const PIECE_OUT_TOKENS = 70;
const COMBINE_OUT_TOKENS = 100;
/** summaries joined in one go */
export const COMBINE_AT_ONCE = 8;

/** The calls a job will make: one per piece, then rounds that join the results, until one is left. */
export function planCalls(pieces: number): { piece: number; combine: number } {
  if (pieces <= 1) return { piece: pieces, combine: 0 };
  let combine = 0;
  let left = pieces;
  while (left > 1) {
    const groups = Math.ceil(left / COMBINE_AT_ONCE);
    combine += groups;
    left = groups;
  }
  return { piece: pieces, combine };
}

/** Seconds a job will take, from the pieces' sizes. */
export function estimateSeconds(chunks: string[], rate: Rate): number {
  const calls = planCalls(chunks.length);
  let sec = 0;
  for (const c of chunks) sec += (words(c) * TOKENS_PER_WORD + 60) / rate.promptTokensPerSec + PIECE_OUT_TOKENS / rate.outputTokensPerSec;
  sec += calls.combine * ((COMBINE_AT_ONCE * 70 + 60) / rate.promptTokensPerSec + COMBINE_OUT_TOKENS / rate.outputTokensPerSec);
  return Math.round(sec);
}

/** "about 40 seconds", "about 6 minutes", "about 1 hour 20 minutes". */
export function describeDuration(sec: number): string {
  if (sec < 90) return `about ${Math.max(5, Math.round(sec / 5) * 5)} seconds`;
  const min = Math.round(sec / 60);
  if (min < 60) return `about ${min} minutes`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `about ${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minutes` : ""}`;
}

/** A job is worth a warning when it will take more than this long. */
export const WARN_AFTER_SECONDS = 45;
