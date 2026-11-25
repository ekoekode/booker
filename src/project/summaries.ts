/**
 * Carrying scene summaries into a merged note. Going from three levels to two joins each chapter's scenes into one note; the joined
 * note must not lose what the other scenes' summaries said. Pure: frontmatter values in, a patch out.
 */

export interface SummarySource {
  title: string;
  synopsis?: string;
  summary?: string;
  summaryAi?: string;
}

export interface SummaryPatch {
  /** the combined summary the author wrote, one line per scene ("Title: text") */
  synopsis?: string;
  /** the combined AI summary, for scenes that only had one of those */
  summary_ai?: string;
  /** keys to remove from the merged note: they described one scene or are out of date now */
  drop: string[];
}

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** A scene's own summary: what the author wrote (`summary`, else `synopsis`). */
export const ownSummaryOf = (s: SummarySource): string => clean(s.summary) || clean(s.synopsis);

/**
 * One scene needs nothing. Several become one list: each scene's summary on its own line, headed by its title when there is more than
 * one line. The summary the first scene's note kept (`summary`) is dropped so the combined text is what shows, and the short AI summary
 * is dropped because it described only the first scene.
 */
export function mergeSummaries(items: SummarySource[]): SummaryPatch {
  const drop: string[] = [];
  if (items.length < 2) return { drop };
  const join = (texts: Array<{ title: string; text: string }>): string => {
    const t = texts.filter((x) => x.text);
    if (!t.length) return "";
    return t.length === 1 && items.length === 1 ? t[0].text : t.map((x) => `${x.title}: ${x.text}`).join("\n");
  };
  const own = join(items.map((i) => ({ title: clean(i.title) || "Scene", text: ownSummaryOf(i) })));
  // AI summaries fill in for scenes with nothing written; only kept as AI text when nothing was written at all
  const ai = join(items.map((i) => ({ title: clean(i.title) || "Scene", text: clean(i.summaryAi) })));
  const patch: SummaryPatch = { drop };
  if (own) {
    patch.synopsis = own;
    drop.push("summary");
  } else if (ai) patch.summary_ai = ai;
  if (own && ai) patch.summary_ai = ai;
  drop.push("summary_ai_short", "summary_ai_words");
  return patch;
}

/** Apply a patch to a frontmatter object (returns a new one). */
export function applySummaryPatch(fm: Record<string, unknown>, patch: SummaryPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fm };
  for (const k of patch.drop) delete out[k];
  if (patch.synopsis !== undefined) out.synopsis = patch.synopsis;
  if (patch.summary_ai !== undefined) out.summary_ai = patch.summary_ai;
  return out;
}
