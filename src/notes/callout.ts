/** Callouts that give a chapter its extras: an epigraph, a summary box or reflection questions. Pure. */

export type CalloutKind = "epigraph" | "summary" | "question";

export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  epigraph: "Epigraph",
  summary: "Chapter summary",
  question: "Discussion questions",
};

/** The Markdown for a callout around `text` (empty text leaves a line to type on). */
export function calloutText(kind: CalloutKind, text: string): string {
  const head = kind === "epigraph" ? "> [!epigraph]" : `> [!${kind}] ${CALLOUT_LABELS[kind]}`;
  const body = text.trim() ? text.trim().split(/\r?\n/) : [""];
  return [head, ...body.map((l) => (l ? `> ${l}` : "> "))].join("\n");
}
