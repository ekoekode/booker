/** Reading bibliographies from other tools: BibTeX (.bib), RIS (.ris) and CSL-JSON (.json). Pure text in, source details out. */
import type { SourceType } from "./types";

export interface BibItem {
  /** the key the other tool used, kept when it is free */
  key?: string;
  title: string;
  authors: string[];
  editors: string[];
  year?: string;
  publisher?: string;
  place?: string;
  edition?: string;
  container?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  type: SourceType;
}

const dash = (s: string) => s.replace(/\s*[-‐‑‒–—]{1,3}\s*/g, "–");
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** "Calvin, John" becomes "John Calvin"; "Calvin, John, Jr." keeps the suffix at the end. */
export function naturalName(n: string): string {
  const parts = n.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
  if (parts.length === 3) return `${parts[2]} ${parts[0]}, ${parts[1]}`.replace(/^(.*), (.*)$/, "$1 $2").trim();
  return n.trim();
}

/** LaTeX leftovers: braces, escaped symbols and the common accent commands. */
export function unlatex(s: string): string {
  const accents: Record<string, string> = { "`": "̀", "'": "́", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇", u: "̆", v: "̌", c: "̧" };
  let t = s.replace(/\\([`'^"~=.uvc])\s*\{?\\?([A-Za-z])\}?/g, (_, a: string, l: string) => (l + accents[a]).normalize("NFC"));
  t = t.replace(/\\(&|%|\$|#|_)/g, "$1").replace(/\\(ss)\b\s*/g, "ß").replace(/\\(aa)\b\s*/g, "å").replace(/\\(o)\b\s*/g, "ø").replace(/\\(ae)\b\s*/g, "æ");
  return tidy(t.replace(/[{}]/g, "").replace(/\\textit|\\emph|\\textbf/g, "").replace(/~/g, " "));
}

const TYPE: Record<string, SourceType> = {
  book: "book", booklet: "book", proceedings: "book", manual: "book", thesis: "book", phdthesis: "book", mastersthesis: "book", techreport: "book", misc: "book", collection: "book",
  inbook: "chapter", incollection: "chapter", inproceedings: "chapter", conference: "chapter",
  article: "article", periodical: "article", jour: "article",
  online: "web", electronic: "web", www: "web",
};

export function parseBibtex(text: string): BibItem[] {
  const out: BibItem[] = [];
  const at = /@(\w+)\s*([{(])/g;
  let m: RegExpExecArray | null;
  while ((m = at.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    // find the matching close of the entry
    const open = m[2];
    const close = open === "{" ? "}" : ")";
    let depth = 1;
    let i = at.lastIndex;
    for (; i < text.length && depth; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) depth--;
    }
    const body = text.slice(at.lastIndex, i - 1);
    at.lastIndex = i;
    const comma = body.indexOf(",");
    if (comma < 0) continue;
    const key = body.slice(0, comma).trim();
    const f: Record<string, string> = {};
    const rest = body.slice(comma + 1);
    const re = /([A-Za-z][\w-]*)\s*=\s*/g;
    let fm: RegExpExecArray | null;
    while ((fm = re.exec(rest))) {
      let j = re.lastIndex;
      let val = "";
      const c = rest[j];
      if (c === "{") {
        let d = 1;
        let k = j + 1;
        for (; k < rest.length && d; k++) {
          if (rest[k] === "{") d++;
          else if (rest[k] === "}") d--;
        }
        val = rest.slice(j + 1, k - 1);
        j = k;
      } else if (c === '"') {
        let k = j + 1;
        for (; k < rest.length && !(rest[k] === '"' && rest[k - 1] !== "\\"); k++);
        val = rest.slice(j + 1, k);
        j = k + 1;
      } else {
        const k = rest.slice(j).search(/[,\n}]/);
        const end = k < 0 ? rest.length : j + k;
        val = rest.slice(j, end).trim();
        j = end;
      }
      f[fm[1].toLowerCase()] = val;
      re.lastIndex = j;
    }
    const names = (v?: string) => (v ? v.split(/\s+and\s+/i).map((x) => naturalName(unlatex(x))).filter(Boolean) : []);
    const title = unlatex(f.title ?? f.booktitle ?? "");
    if (!title) continue;
    const kind: SourceType = TYPE[type] ?? "book";
    const container = unlatex(f.journal ?? f.journaltitle ?? (kind === "chapter" ? f.booktitle ?? "" : f.series ?? ""));
    const year = (f.year ?? f.date ?? "").match(/\d{4}/)?.[0];
    const url = f.url ?? (f.doi ? `https://doi.org/${f.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : undefined);
    out.push({
      key,
      title,
      authors: names(f.author),
      editors: names(f.editor),
      type: kind,
      ...(year && { year }),
      ...(f.publisher && { publisher: unlatex(f.publisher) }),
      ...((f.address ?? f.location) && { place: unlatex(f.address ?? f.location) }),
      ...(f.edition && { edition: unlatex(f.edition) }),
      ...(container && { container }),
      ...(f.volume && { volume: unlatex(f.volume) }),
      ...((f.number ?? f.issue) && { issue: unlatex(f.number ?? f.issue) }),
      ...(f.pages && { pages: dash(unlatex(f.pages)) }),
      ...(url && { url: unlatex(url) }),
    });
  }
  return out;
}

const RIS_TYPE: Record<string, SourceType> = { BOOK: "book", EBOOK: "book", THES: "book", RPRT: "book", GEN: "book", CHAP: "chapter", ECHAP: "chapter", CONF: "chapter", JOUR: "article", MGZN: "article", NEWS: "article", EJOUR: "article", ELEC: "web", WEB: "web", BLOG: "web" };

export function parseRis(text: string): BibItem[] {
  const out: BibItem[] = [];
  let cur: Record<string, string[]> = {};
  const flush = () => {
    const f = cur;
    cur = {};
    const first = (k: string) => f[k]?.[0]?.trim();
    const title = first("TI") ?? first("T1") ?? first("CT");
    if (!title) return;
    const type = RIS_TYPE[(first("TY") ?? "").toUpperCase()] ?? "book";
    const year = (first("PY") ?? first("Y1") ?? first("DA"))?.match(/\d{4}/)?.[0];
    const sp = first("SP");
    const ep = first("EP");
    const container = first("T2") ?? first("JO") ?? first("JF") ?? first("BT");
    const url = first("UR") ?? (first("DO") ? `https://doi.org/${first("DO")}` : undefined);
    const au = [...(f.AU ?? []), ...(f.A1 ?? [])].map(naturalName);
    out.push({
      title: tidy(title),
      authors: au,
      editors: [...(f.ED ?? []), ...(f.A2 ?? [])].map(naturalName),
      type,
      ...(year && { year }),
      ...(first("PB") && { publisher: first("PB") }),
      ...(first("CY") && { place: first("CY") }),
      ...(first("ET") && { edition: first("ET") }),
      ...(container && type !== "book" && { container: tidy(container) }),
      ...(first("VL") && { volume: first("VL") }),
      ...(first("IS") && { issue: first("IS") }),
      ...(sp && { pages: ep ? `${sp}–${ep}` : sp }),
      ...(url && { url }),
    });
  };
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === "TY") cur = {};
    if (m[1] === "ER") flush();
    else (cur[m[1]] ??= []).push(m[2].trim());
  }
  return out;
}

export function parseCslJson(text: string): BibItem[] {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const who = (a: any[] | undefined) => (a ?? []).map((n) => (n.literal ? String(n.literal) : [n.given, n.family].filter(Boolean).join(" "))).filter(Boolean);
  const out: BibItem[] = [];
  for (const it of list) {
    const title = tidy(String(it.title ?? ""));
    if (!title) continue;
    const t = String(it.type ?? "book");
    const type: SourceType = /chapter|paper-conference/.test(t) ? "chapter" : /article|journal|magazine|newspaper/.test(t) ? "article" : /webpage|post/.test(t) ? "web" : "book";
    const year = String(it.issued?.["date-parts"]?.[0]?.[0] ?? it.issued?.literal ?? "").match(/\d{4}/)?.[0];
    out.push({
      key: it.id ? String(it.id) : undefined,
      title,
      authors: who(it.author),
      editors: who(it.editor),
      type,
      ...(year && { year }),
      ...(it.publisher && { publisher: String(it.publisher) }),
      ...(it["publisher-place"] && { place: String(it["publisher-place"]) }),
      ...(it.edition && { edition: String(it.edition) }),
      ...(it["container-title"] && { container: String(it["container-title"]) }),
      ...(it.volume && { volume: String(it.volume) }),
      ...(it.issue && { issue: String(it.issue) }),
      ...(it.page && { pages: dash(String(it.page)) }),
      ...((it.URL ?? it.DOI) && { url: String(it.URL ?? `https://doi.org/${it.DOI}`) }),
    });
  }
  return out;
}

export function parseBibliography(name: string, text: string): BibItem[] {
  const e = name.toLowerCase().split(".").pop();
  if (e === "ris") return parseRis(text);
  if (e === "json") return parseCslJson(text);
  return parseBibtex(text);
}
