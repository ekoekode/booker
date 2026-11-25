/** Open dictionaries made into e-Sword/MySword-style dictionary modules, so the word study and the Reader read them like any other. Pure. */
import { decodeEntities } from "./thml";

export interface DictRow {
  word: string;
  text: string;
}

const clean = (s: string) => decodeEntities(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();

/** Open Scriptures' Strong's dictionaries (a JS file holding one JSON object). */
export function parseStrongsJs(js: string, prefix: "H" | "G"): DictRow[] {
  const i = js.indexOf("{");
  const j = js.lastIndexOf("}");
  const obj = JSON.parse(js.slice(i, j + 1)) as Record<string, { lemma?: string; xlit?: string; translit?: string; pron?: string; derivation?: string; strongs_def?: string; kjv_def?: string }>;
  const out: DictRow[] = [];
  for (const [key, e] of Object.entries(obj)) {
    const n = /\d+/.exec(key)?.[0];
    if (!n) continue;
    const say = [e.lemma, e.xlit ?? e.translit, e.pron && `(${e.pron})`].filter(Boolean).join(" ");
    const parts = [say, e.strongs_def && clean(e.strongs_def), e.derivation && `Derivation: ${clean(e.derivation)}`, e.kjv_def && `KJV: ${clean(e.kjv_def)}`].filter(Boolean);
    out.push({ word: `${prefix}${Number(n)}`, text: parts.join("\n\n") });
  }
  return out.sort((a, b) => Number(a.word.slice(1)) - Number(b.word.slice(1)));
}

/** STEPBible's brief lexicons: tab-separated, the first row of each extended Strong's number carries its Hebrew or Greek, transliteration, gloss and meaning. */
export function parseStepLexicon(text: string, prefix: "H" | "G"): DictRow[] {
  const out = new Map<string, DictRow>();
  const re = new RegExp(`^${prefix}\\d{4}`);
  for (const line of text.split(/\r?\n/)) {
    if (!re.test(line)) continue;
    const c = line.split("\t");
    if (c.length < 8) continue;
    const key = c[0].trim();
    const word = `${prefix}${Number(key.slice(1))}`;
    if (out.has(word)) continue;
    const say = [c[3], c[4]].map((x) => x.trim()).filter(Boolean).join(" ");
    const parts = [say, c[6] && `${clean(c[6])}`, c[7] && clean(c[7])].filter(Boolean);
    out.set(word, { word, text: parts.join("\n\n") });
  }
  return [...out.values()];
}
