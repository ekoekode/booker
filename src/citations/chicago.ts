/** Chicago notes-and-bibliography: the full note, the short note and the bibliography entry. Output is Markdown. */
import { lastName } from "../sources/ids";
import type { Source } from "../sources/types";

const list = (names: string[], et: number) => {
  if (names.length > et) return `${names[0]} et al.`;
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
};

const isRange = (s: string) => /^[\divxlc]+(?:\s*[-–]\s*[\divxlc]+)?$/i.test(s);

/** "45" or "45-47" stand for pages and need no "p."; "chap. 3" and "ch. 2, sec. 4" stay as written. */
export function locator(loc: string | undefined): string {
  const l = (loc ?? "").trim().replace(/-/g, "–");
  return l;
}

const place = (s: Source) => {
  const pub = [s.place, s.publisher].filter(Boolean).join(": ");
  return pub + (s.year ? `${pub ? ", " : ""}${s.year}` : "");
};

const edition = (s: Source) => (s.edition ? (/ed\.?$/i.test(s.edition) ? s.edition : `${s.edition} ed.`) : "");
const trans = (s: Source) => (s.translators?.length ? `trans. ${list(s.translators, 99)}` : "");
const eds = (s: Source) => (s.editors?.length ? `ed. ${list(s.editors, 99)}` : "");

/** A title short enough for a short note: the words before a colon, at most four. */
export function shortTitle(t: string): string {
  const head = t.split(/[:?]/)[0].trim();
  const w = head.split(/\s+/);
  return w.length > 4 ? w.slice(0, 4).join(" ") : head;
}

/** "Last", "Last and Last", "Last, Last, and Last", "Last et al." for short notes. */
function shortAuthors(s: Source): string {
  const names = s.authors.map(lastName);
  if (names.length > 3) return `${names[0]} et al.`;
  return list(names, 3);
}

const join = (parts: Array<string | false | undefined>) => parts.filter(Boolean).join(", ");

export function fullNote(s: Source, loc?: string): string {
  const author = list(s.authors, 3);
  const l = locator(loc);
  const pub = place(s);
  const who = author ? `${author}, ` : "";
  switch (s.type) {
    case "article": {
      const vol = s.volume ? ` ${s.volume}${s.issue ? `, no. ${s.issue}` : ""}` : "";
      const year = s.year ? ` (${s.year})` : "";
      const pages = l || s.pages;
      return `${who}“${s.title},” *${s.container ?? ""}*${vol}${year}${pages ? `: ${pages}` : ""}.`.replace(/\*\*/g, "");
    }
    case "web":
      return `${who}“${s.title},” ${s.container ? `${s.container}, ` : ""}${[s.year, s.url].filter(Boolean).join(", ")}${l ? `, ${l}` : ""}.`.replace(/, \./, ".");
    case "chapter":
      return `${who}“${s.title},” in *${s.container ?? ""}*${s.editors?.length ? `, ${eds(s)}` : ""}${pub ? ` (${pub})` : ""}${l ? `, ${l}` : s.pages ? `, ${s.pages}` : ""}.`.replace(/\*\*/g, "");
    default: {
      const mid = join([`*${s.title}*`, edition(s), trans(s), eds(s)]);
      return `${who}${mid}${pub ? ` (${pub})` : ""}${l ? `, ${l}` : ""}.`;
    }
  }
}

export function shortNote(s: Source, loc?: string): string {
  const l = locator(loc);
  const t = shortTitle(s.title);
  const title = s.type === "book" ? `*${t}*` : `“${t},”`;
  const who = shortAuthors(s);
  if (s.type === "book") return `${who ? who + ", " : ""}${title}${l ? `, ${l}` : ""}.`;
  return `${who ? who + ", " : ""}${title}${l ? ` ${l}` : ""}`.replace(/,” \s*$/, ",”").replace(/,”$/, "”.").replace(/,” (.+)$/, ",” $1.");
}

const invert = (n: string) => {
  const parts = n.trim().split(/\s+/);
  if (parts.length < 2 || n.includes(",")) return n;
  const last = lastName(n);
  return `${last}, ${parts.slice(0, parts.lastIndexOf(last)).join(" ")}`.replace(/,\s*$/, "");
};

export function bibliographyEntry(s: Source): string {
  const names = s.authors.length > 10 ? [...s.authors.slice(0, 7), "et al."] : s.authors;
  const author = names.length ? [invert(names[0]), ...names.slice(1)].reduce((acc, n, i, a) => (i === 0 ? n : i === a.length - 1 ? `${acc}, and ${n}` : `${acc}, ${n}`)) : "";
  const a = author ? `${author.replace(/\.$/, "")}. ` : "";
  const pub = place(s);
  switch (s.type) {
    case "article": {
      const vol = s.volume ? ` ${s.volume}${s.issue ? `, no. ${s.issue}` : ""}` : "";
      return `${a}“${s.title}.” *${s.container ?? ""}*${vol}${s.year ? ` (${s.year})` : ""}${s.pages ? `: ${s.pages}` : ""}.`.replace(/\*\*/g, "");
    }
    case "web":
      return `${a}“${s.title}.” ${s.container ? `${s.container}. ` : ""}${[s.year, s.url].filter(Boolean).join(". ")}.`.replace(/\.\.$/, ".");
    case "chapter":
      return `${a}“${s.title}.” In *${s.container ?? ""}*${s.editors?.length ? `, ${eds(s).replace(/^ed\./, "edited by")}` : ""}${s.pages ? `, ${s.pages}` : ""}. ${pub}.`.replace(/\*\*/g, "").replace(/ \.$/, ".");
    default: {
      const extra = [edition(s), s.translators?.length ? `Translated by ${list(s.translators, 99)}` : "", s.editors?.length ? `Edited by ${list(s.editors, 99)}` : ""].filter(Boolean).map((x) => `${x.replace(/\.$/, "")}. `).join("");
      return `${a}*${s.title}*. ${extra}${pub ? `${pub}.` : ""}`.trim();
    }
  }
}

/** Sort key for a bibliography: first author's last name, then title. */
export const sortKey = (s: Source) => `${s.authors[0] ? lastName(s.authors[0]) : s.title}\u0000${s.title}`.toLowerCase();
