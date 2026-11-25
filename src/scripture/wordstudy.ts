/** Word studies: finding a lexicon entry and shaping it into a line for the text. Pure. */
import { fold } from "../sources/index";
import { entryText, type DictEntry } from "./esword";
import { normStrongs } from "./interlinear";

const HEBREW = /[֐-׿יִ-ﭏ]+/;

/** "h430", "H0430" and "430" all name Strong's H430 (a bare number is taken as it is, with no letter). */
export function strongsKey(q: string): string | null {
  const m = /^\s*([HGhg])?\s*0*(\d{1,5})\s*$/.exec(q);
  return m ? `${(m[1] ?? "").toUpperCase()}${m[2]}` : null;
}

export function findEntries(entries: DictEntry[], q: string, limit = 30): DictEntry[] {
  const key = strongsKey(q);
  const f = fold(q).trim();
  if (!f && !key) return [];
  const scored: Array<{ e: DictEntry; s: number }> = [];
  for (const e of entries) {
    const wk = strongsKey(e.word);
    const w = fold(e.word);
    let s = 0;
    if (key && wk && (wk === key || wk.replace(/^[HG]/, "") === key.replace(/^[HG]/, "") && (!key.match(/^[HG]/) || wk[0] === key[0] || !wk.match(/^[HG]/)))) s = 100;
    else if (w === f) s = 90;
    else if (f && w.startsWith(f)) s = 70;
    else if (f && f.length >= 2 && fold(e.text).includes(f)) s = 10;
    if (s) scored.push({ e, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}

export interface Study {
  hebrew: string;
  translit: string;
  gloss: string;
  strongs: string;
}

/** A first guess at the fields from an entry; the writer corrects them in the window. */
export function guessStudy(e: DictEntry): Study {
  const text = entryText(e.text);
  const hebrew = HEBREW.exec(e.word)?.[0] ?? HEBREW.exec(text)?.[0] ?? "";
  const strongs = /\b([HG]\d{1,5})\b/.exec(e.word)?.[1] ?? /\b([HG]\d{1,5})\b/.exec(text)?.[1] ?? (strongsKey(e.word) ?? "");
  let rest = hebrew ? text.slice(text.indexOf(hebrew) + hebrew.length) : text;
  const tl = /^[\s,;:(\[]*([A-Za-z'’ʼʻ\-À-ɏ]{2,30})/.exec(rest);
  const translit = tl ? tl[1] : "";
  if (tl) rest = rest.slice(tl[0].length);
  const gloss = rest.replace(/^[\s,;:.)\]\-–—]+/, "").replace(/^[a-z\u00C0-\u024F]+(?:-[a-z\u00C0-\u024F'’]+)+['’]?[\s,;:]*/i, "").split(/\n/)[0].slice(0, 160).trim();
  return { hebrew, translit, gloss, strongs };
}

export type StudyLayout = "inline" | "block";

export function formatStudy(s: Study, layout: StudyLayout): string {
  const head = s.hebrew ? `**${s.hebrew}**` : "";
  const meta = [s.translit && `*${s.translit}*`, s.strongs].filter(Boolean).join(", ");
  const line = `${head}${meta ? `${head ? " " : ""}(${meta})` : ""}${s.gloss ? `${head || meta ? ": " : ""}${s.gloss}` : ""}`.trim();
  return layout === "block" ? line.split("\n").map((l) => `> ${l}`).join("\n") : line;
}

const REF = /\b([HG])0*(\d{1,4})[a-z]?\b/g;

/** Text cut into plain stretches and the Strong's numbers in it (H430, G3056, H0430a), each number written as the dictionaries spell it. */
export function splitStrongs(text: string): Array<{ t: string; s?: string }> {
  const out: Array<{ t: string; s?: string }> = [];
  let at = 0;
  for (const m of text.matchAll(REF)) {
    if (m.index! > at) out.push({ t: text.slice(at, m.index) });
    out.push({ t: m[0], s: normStrongs(m[0]) });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ t: text.slice(at) });
  return out;
}

/** The Strong's numbers the texts mention, the most mentioned first, leaving out `self`. */
export function relatedStrongs(texts: string[], self: string, limit = 24): string[] {
  const n = new Map<string, number>();
  for (const t of texts) for (const p of splitStrongs(t)) if (p.s && p.s !== normStrongs(self)) n.set(p.s, (n.get(p.s) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, limit).map((x) => x[0]);
}

/** The entry a dictionary has for a Strong's number; a bare number would match the other language's entry, so the letter must agree. */
export function entryFor(entries: DictEntry[], strongs: string): DictEntry | null {
  const key = normStrongs(strongs);
  const q = key || strongs;
  return (
    findEntries(entries, q, 3).find((e) => !key || !/^[HG]/i.test(e.word) || e.word.toUpperCase().startsWith(key[0]) || new RegExp(`\\b${key}\\b`).test(e.word.toUpperCase())) ?? null
  );
}

/** Card ids in the order the writer last arranged them; cards not seen before follow in the order given. */
export function orderCards(ids: string[], saved: string[] | undefined): string[] {
  const known = (saved ?? []).filter((id) => ids.includes(id));
  return [...known, ...ids.filter((id) => !known.includes(id))];
}

/** Move one card up or down a place, or to the top. */
export function moveCard(order: string[], id: string, how: "up" | "down" | "top"): string[] {
  const i = order.indexOf(id);
  if (i < 0) return order;
  const out = order.filter((x) => x !== id);
  out.splice(how === "top" ? 0 : Math.max(0, Math.min(out.length, how === "up" ? i - 1 : i + 1)), 0, id);
  return out;
}
