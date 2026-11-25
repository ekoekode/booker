/** Prompts for the summary model, in the chat format Qwen expects. Pure. */

export function chatPrompt(system: string, user: string): string {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;
}

const SYSTEM = "You summarise text faithfully, in your own words. Use only what the text says. Do not quote it and do not add anything that is not in it.";

const sentences = (n: number) => (n === 1 ? "one sentence" : `${n} sentences`);

/** A sentence for the system prompt naming the characters, so a summary says "Mara Voss" and not "she". Empty when there are none. */
export function namesHint(names: string[]): string {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!list.length) return "";
  const who = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return ` The characters are ${who}. Always call a character by name, never just "he" or "she".`;
}

/** Summarise one piece of the text. */
export function pieceSummaryPrompt(piece: string, n = 3, hint = ""): string {
  return chatPrompt(SYSTEM + hint, `Summarise this passage in ${sentences(n)}, in your own words.\n\n${piece}`);
}

/** Join the summaries of several pieces into one summary. */
export function combinePrompt(parts: string[], n: number, hint = ""): string {
  return chatPrompt(SYSTEM + hint, `These are summaries of consecutive parts of one text. Combine them into one summary in ${sentences(n)}.\n\n${parts.map((p, i) => `${i + 1}. ${p}`).join("\n\n")}`);
}

/** Keep at most `n` sentences: a small model runs on past the length it was asked for. */
export function clampSentences(text: string, n: number): string {
  const found = text.match(/[^.!?]+(?:[.!?]+["”’)]*|$)\s*/g) ?? [text];
  return found.slice(0, Math.max(1, n)).join("").trim();
}

/** The model sometimes opens with a label or closes mid-sentence; tidy the ends. */
export function tidy(out: string): string {
  let t = out.trim().replace(/^(?:summary|here is (?:a|the) summary)[^\n:]*:\s*/i, "");
  const end = Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"));
  if (end > 0 && !/[.!?"”’)]$/.test(t)) t = t.slice(0, end + 1);
  return t.trim();
}
