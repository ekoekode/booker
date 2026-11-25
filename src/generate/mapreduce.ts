/** A long text summarised piece by piece, then the pieces joined. The model is passed in, so this is testable. */
import { COMBINE_AT_ONCE, chunkText, planCalls } from "./chunk";
import { clampSentences, combinePrompt, pieceSummaryPrompt, tidy } from "./prompt";

export type Write = (prompt: string, maxTokens: number) => Promise<string>;

export interface Progress {
  /** what is happening now */
  step: string;
  done: number;
  total: number;
}

export interface Job {
  /** sentences wanted in the final summary */
  sentences: number;
  write: Write;
  onProgress?: (p: Progress) => void;
  cancelled?: () => boolean;
  chunkWords?: number;
  /** names of people and places, so summaries use them (see namesHint) */
  hint?: string;
}

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

/** Summarise a text of any length. Throws Cancelled when `cancelled()` turns true between calls. */
export async function summarizeLong(text: string, job: Job): Promise<string> {
  const pieces = chunkText(text, job.chunkWords);
  if (!pieces.length) return "";
  const plan = planCalls(pieces.length);
  const total = plan.piece + plan.combine;
  let done = 0;
  const call = async (step: string, prompt: string, sentences: number) => {
    const maxTokens = 35 * sentences + 30;
    if (job.cancelled?.()) throw new Cancelled();
    job.onProgress?.({ step, done, total });
    const out = clampSentences(tidy(await job.write(prompt, maxTokens)), sentences);
    done++;
    if (job.cancelled?.()) throw new Cancelled();
    job.onProgress?.({ step, done, total });
    return out;
  };
  // one piece: the summary is the answer
  if (pieces.length === 1) return call("Summarising", pieceSummaryPrompt(pieces[0], job.sentences, job.hint), job.sentences);
  let parts: string[] = [];
  for (let i = 0; i < pieces.length; i++) parts.push(await call(`Summarising part ${i + 1} of ${pieces.length}`, pieceSummaryPrompt(pieces[i], 3, job.hint), 3));
  while (parts.length > 1) {
    const next: string[] = [];
    const groups = Math.ceil(parts.length / COMBINE_AT_ONCE);
    const last = groups === 1;
    for (let g = 0; g < groups; g++) {
      const group = parts.slice(g * COMBINE_AT_ONCE, (g + 1) * COMBINE_AT_ONCE);
      next.push(await call(last ? "Writing the final summary" : "Joining summaries", combinePrompt(group, last ? job.sentences : 4, job.hint), last ? job.sentences : 4));
    }
    parts = next;
  }
  return parts[0];
}
