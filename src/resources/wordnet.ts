/** Princeton WordNet 3.0 turned into dictionary rows: for each word, its senses by part of speech with their synonyms. Pure. */
import type { DictRow } from "./dictionaries";

export interface WordNetFiles {
  noun: string;
  verb: string;
  adj: string;
  adv: string;
}

const POS: Array<[keyof WordNetFiles, string]> = [
  ["noun", "n."],
  ["verb", "v."],
  ["adj", "adj."],
  ["adv", "adv."],
];

/** Most senses kept per word and part of speech. */
const MAX_SENSES = 6;

const nice = (w: string) => w.replace(/\(\w+\)$/, "").replace(/_/g, " ").toLowerCase();

interface Sense {
  pos: string;
  gloss: string;
  words: string[];
}

/** One data file: its synsets as { words, gloss }. Header lines (they start with two spaces) are skipped. */
export function parseDataFile(text: string, pos: string): Sense[] {
  const out: Sense[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const bar = line.indexOf(" | ");
    if (bar < 0) continue;
    const head = line.slice(0, bar).split(" ");
    const count = parseInt(head[3], 16);
    if (!Number.isFinite(count) || count < 1) continue;
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      const w = head[4 + i * 2];
      if (w) words.push(nice(w));
    }
    let gloss = line.slice(bar + 3).trim();
    const ex = gloss.indexOf('; "');
    if (ex >= 0) gloss = gloss.slice(0, ex);
    out.push({ pos, words, gloss: gloss.replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** Rows sorted by word. Each row's text is "n. gloss" lines with a "Synonyms: a, b" line under each sense that has some. */
export function parseWordNet(files: WordNetFiles): DictRow[] {
  const byWord = new Map<string, Map<string, Sense[]>>();
  for (const [key, label] of POS) {
    for (const s of parseDataFile(files[key], label)) {
      for (const w of new Set(s.words)) {
        let per = byWord.get(w);
        if (!per) byWord.set(w, (per = new Map()));
        const list = per.get(label) ?? [];
        if (list.length < MAX_SENSES) list.push(s);
        per.set(label, list);
      }
    }
  }
  const rows: DictRow[] = [];
  for (const [word, per] of byWord) {
    const blocks: string[] = [];
    for (const [, label] of POS) {
      for (const s of per.get(label) ?? []) {
        const syn = [...new Set(s.words)].filter((x) => x !== word);
        blocks.push(`${label} ${s.gloss}${syn.length ? `\nSynonyms: ${syn.join(", ")}` : ""}`);
      }
    }
    rows.push({ word, text: blocks.join("\n\n") });
  }
  return rows.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
}

/** The files of an uncompressed tar archive by base name. */
export function readTarBuffer(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  let at = 0;
  while (at + 512 <= buf.length) {
    const head = buf.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const z = head.indexOf(0);
    const name = dec.decode(head.subarray(0, z < 0 || z > 100 ? 100 : z));
    const size = parseInt(dec.decode(head.subarray(124, 136)).replace(/\0/g, "").trim() || "0", 8);
    const type = String.fromCharCode(head[156] || 48);
    at += 512;
    if (type === "0" || type === "\0") out.set(name.slice(name.lastIndexOf("/") + 1), buf.subarray(at, at + size));
    at += Math.ceil(size / 512) * 512;
  }
  return out;
}
