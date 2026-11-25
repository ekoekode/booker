/**
 * Citation styles. Chicago and SBL put each citation in a note (full the first time, short afterwards); APA and MLA put it in the
 * text, in brackets. Each style also writes the bibliography entry and says what to call the bibliography. Output is Markdown. Pure.
 */
import { lastName } from "../sources/ids";
import type { Source } from "../sources/types";
import { bibliographyEntry, fullNote, shortNote, sortKey } from "./chicago";

export type StyleId = "chicago" | "sbl" | "apa" | "mla";

export interface CitationStyle {
  id: StyleId;
  name: string;
  /** true when a citation is written in the text, false when it becomes a footnote */
  inline: boolean;
  /** what the list of sources is called */
  bibliographyTitle: string;
  /** the citation for a source; `first` is true the first time it is cited */
  cite(s: Source, loc: string | undefined, first: boolean): string;
  entry(s: Source): string;
  sort(a: Source, b: Source): number;
}

const dash = (t: string) => t.replace(/(\d)\s*-\s*(\d)/g, "$1–$2");
const stripDot = (t: string) => t.replace(/\.+$/, "");
const endDot = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);

/** Given names as initials: "Ann Marie" becomes "A. M.". */
function initials(given: string): string {
  return given
    .split(/[\s]+/)
    .filter(Boolean)
    .map((p) => (p.includes("-") ? p.split("-").map((x) => `${x[0]}.`).join("-") : /\.$/.test(p) ? p : `${p[0]}.`))
    .join(" ");
}

function split(author: string): { last: string; given: string } {
  const a = author.trim();
  if (a.includes(",")) {
    const [last, ...rest] = a.split(",");
    return { last: last.trim(), given: rest.join(",").trim() };
  }
  const last = lastName(a);
  const idx = a.lastIndexOf(last);
  return { last, given: a.slice(0, idx).trim() };
}

const sortBy = (s: Source) => `${s.authors[0] ? split(s.authors[0]).last : s.title.replace(/^(a|an|the)\s+/i, "")}\u0000${s.year ?? ""}\u0000${s.title}`.toLowerCase();
const byAuthor = (a: Source, b: Source) => sortBy(a).localeCompare(sortBy(b));

// ---------------------------------------------------------------- Chicago

const chicago: CitationStyle = {
  id: "chicago",
  name: "Chicago (notes and bibliography)",
  inline: false,
  bibliographyTitle: "Bibliography",
  cite: (s, loc, first) => (first ? fullNote(s, loc) : shortNote(s, loc)),
  entry: bibliographyEntry,
  sort: (a, b) => sortKey(a).localeCompare(sortKey(b)),
};

// ------------------------------------------------------------------- SBL

const names = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);
const pubOf = (s: Source) => [s.place, s.publisher].filter(Boolean).join(": ") + (s.year ? `${s.place || s.publisher ? ", " : ""}${s.year}` : "");

function sblEntry(s: Source): string {
  const first = s.authors.map((a, i) => {
    if (i > 0) return a;
    const p = split(a);
    return p.given ? `${p.last}, ${p.given}` : p.last;
  });
  const author = names(first);
  const a = author ? `${stripDot(author)}. ` : "";
  const pub = pubOf(s);
  const eds = s.editors?.length ? `Edited by ${names(s.editors)}. ` : "";
  const trans = s.translators?.length ? `Translated by ${names(s.translators)}. ` : "";
  switch (s.type) {
    case "article":
      return `${a}“${s.title}.” *${s.container ?? ""}* ${s.volume ?? ""}${s.issue ? `.${s.issue}` : ""}${s.year ? ` (${s.year})` : ""}${s.pages ? `: ${dash(s.pages)}` : ""}.`.replace(/\*\*/g, "").replace(/\*\s/, "* ").replace(/ +\(/, " (").replace(/ \./, ".");
    case "web":
      return `${a}“${s.title}.” ${s.container ? `${s.container}. ` : ""}${[s.year, s.url].filter(Boolean).join(". ")}.`.replace(/\.\.$/, ".");
    case "chapter":
      return `${a}“${s.title}.” ${s.pages ? `Pages ${dash(s.pages)} in ` : "In "}*${s.container ?? ""}*. ${eds}${pub ? `${pub}.` : ""}`.replace(/\*\*/g, "").trim();
    default:
      return `${a}*${s.title}*. ${s.edition ? `${/ed\.?$/i.test(s.edition) ? s.edition : `${s.edition} ed.`} ` : ""}${trans}${eds}${pub ? `${pub}.` : ""}`.replace(/  +/g, " ").trim();
  }
}

/** The short note drops the comma after a book's title and uses no "p."; otherwise it follows Chicago. */
const sbl: CitationStyle = {
  id: "sbl",
  name: "SBL (Society of Biblical Literature)",
  inline: false,
  bibliographyTitle: "Bibliography",
  cite: (s, loc, first) => (first ? fullNote(s, loc) : shortNote(s, loc)),
  entry: sblEntry,
  sort: (a, b) => sortKey(a).localeCompare(sortKey(b)),
};

// ------------------------------------------------------------------- APA

function apaAuthors(xs: string[]): string {
  const f = xs.map((a) => {
    const { last, given } = split(a);
    return given ? `${last}, ${initials(given)}` : last;
  });
  if (f.length <= 1) return f[0] ?? "";
  if (f.length <= 20) return `${f.slice(0, -1).join(", ")}, & ${f[f.length - 1]}`;
  return `${f.slice(0, 19).join(", ")}, … ${f[f.length - 1]}`;
}

function apaInText(s: Source, loc?: string): string {
  const who = s.authors.map((a) => split(a).last);
  const author = who.length === 0 ? `“${s.title.split(/[:?]/)[0].trim()},”` : who.length === 1 ? `${who[0]},` : who.length === 2 ? `${who[0]} & ${who[1]},` : `${who[0]} et al.,`;
  const l = (loc ?? "").trim();
  const page = l ? (/^\d+$/.test(l) ? `p. ${l}` : /^\d+\s*[-–]\s*\d+$/.test(l) ? `pp. ${dash(l)}` : l) : "";
  return `(${author} ${s.year || "n.d."}${page ? `, ${page}` : ""})`;
}

function apaEntry(s: Source): string {
  const who = apaAuthors(s.authors);
  const year = `(${s.year || "n.d."})`;
  const lead = who ? `${endDot(who)} ${year}. ` : `${s.type === "article" || s.type === "chapter" ? `${endDot(s.title)} ${year}. ` : `*${stripDot(s.title)}*. ${year}. `}`;
  const hasWho = !!who;
  const pages = s.pages ? dash(s.pages) : "";
  switch (s.type) {
    case "article": {
      const vol = s.volume ? `, *${s.volume}*${s.issue ? `(${s.issue})` : ""}` : "";
      return `${lead}${hasWho ? `${endDot(s.title)} ` : ""}*${s.container ?? ""}*${vol}${pages ? `, ${pages}` : ""}.${s.url ? ` ${s.url}` : ""}`.replace(/\*\*/g, "");
    }
    case "chapter": {
      const eds = s.editors?.length ? `In ${s.editors.map((e) => { const p = split(e); return `${initials(p.given)} ${p.last}`.trim(); }).join(" & ")} (${s.editors.length > 1 ? "Eds." : "Ed."}), ` : "In ";
      return `${lead}${hasWho ? `${endDot(s.title)} ` : ""}${eds}*${s.container ?? ""}*${pages ? ` (pp. ${pages})` : ""}. ${s.publisher ?? ""}.`.replace(/\*\*/g, "").replace(/ \.$/, ".");
    }
    case "web":
      return `${lead}${hasWho ? `*${stripDot(s.title)}*. ` : ""}${s.container ? `${s.container}. ` : ""}${s.url ?? ""}`.trim();
    default: {
      const ed = s.edition ? ` (${/ed\.?$/i.test(s.edition) ? stripDot(s.edition) + "." : `${s.edition} ed.`})` : "";
      return `${lead}${hasWho ? `*${stripDot(s.title)}*${ed}. ` : ed ? `${ed.trim()} ` : ""}${s.publisher ? `${s.publisher}.` : ""}`.trim();
    }
  }
}

const apa: CitationStyle = {
  id: "apa",
  name: "APA (7th edition)",
  inline: true,
  bibliographyTitle: "References",
  cite: (s, loc) => apaInText(s, loc),
  entry: apaEntry,
  sort: byAuthor,
};

// ------------------------------------------------------------------- MLA

function mlaAuthors(xs: string[]): string {
  if (!xs.length) return "";
  const first = split(xs[0]);
  const f = first.given ? `${first.last}, ${first.given}` : first.last;
  if (xs.length === 1) return f;
  if (xs.length === 2) return `${f}, and ${xs[1]}`;
  return `${f}, et al.`;
}

function mlaInText(s: Source, loc?: string): string {
  const who = s.authors.map((a) => split(a).last);
  const author = who.length === 0 ? `“${s.title.split(/[:?]/)[0].trim()}”` : who.length === 1 ? who[0] : who.length === 2 ? `${who[0]} and ${who[1]}` : `${who[0]} et al.`;
  const l = dash((loc ?? "").trim().replace(/^pp?\.\s*/i, ""));
  return `(${author}${l ? ` ${l}` : ""})`;
}

function mlaEntry(s: Source): string {
  const who = mlaAuthors(s.authors);
  const a = who ? `${endDot(who)} ` : "";
  const pages = s.pages ? dash(s.pages) : "";
  const eds = s.editors?.length ? `edited by ${names(s.editors)}` : "";
  const trans = s.translators?.length ? `translated by ${names(s.translators)}` : "";
  const list = (xs: Array<string | undefined | false>) => xs.filter(Boolean).join(", ");
  switch (s.type) {
    case "article": {
      const loc = list([s.volume && `vol. ${s.volume}`, s.issue && `no. ${s.issue}`, s.year, pages && `pp. ${pages}`]);
      return `${a}“${endDot(s.title)}” *${s.container ?? ""}*${loc ? `, ${loc}` : ""}.`.replace(/\*\*/g, "");
    }
    case "chapter":
      return `${a}“${endDot(s.title)}” *${s.container ?? ""}*${list(["", eds, s.publisher, s.year, pages && `pp. ${pages}`]).replace(/^,\s*/, ", ")}.`.replace(/\*\*/g, "").replace(/\*, ,/, "*,");
    case "web":
      return `${a}“${endDot(s.title)}” ${s.container ? `*${s.container}*, ` : ""}${list([s.year, s.url])}.`.replace(/\.\.$/, ".");
    default: {
      const mid = list([s.edition && (/ed\.?$/i.test(s.edition) ? s.edition : `${s.edition} ed.`), trans, eds, s.publisher, s.year]);
      return `${a}*${stripDot(s.title)}*. ${mid ? `${mid}.` : ""}`.trim();
    }
  }
}

const mla: CitationStyle = {
  id: "mla",
  name: "MLA (9th edition)",
  inline: true,
  bibliographyTitle: "Works Cited",
  cite: (s, loc) => mlaInText(s, loc),
  entry: mlaEntry,
  sort: byAuthor,
};

export const STYLES: CitationStyle[] = [chicago, sbl, apa, mla];
export const DEFAULT_STYLE: StyleId = "chicago";
export const styleById = (id: unknown): CitationStyle => STYLES.find((s) => s.id === id) ?? chicago;
