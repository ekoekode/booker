/** ThML (CCEL's markup for books) turned into a Booker library: a tree of titled sections with plain-text paragraphs. Pure. */

export interface LibEntry {
  id: number;
  parent: number | null;
  level: string;
  locator: string;
  key: string;
  title: string;
  text: string;
}

export interface LibMeta {
  title: string;
  authors: string[];
  year?: string;
  description?: string;
}

export interface ThmlWork {
  meta: LibMeta;
  entries: LibEntry[];
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function attr(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return m ? decodeEntities(m[2] ?? m[3] ?? "").trim() : "";
}

/** Blocks that start a new paragraph, and those that only start a new line. */
const PARA = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "verse", "table", "ul", "ol", "li", "div", "argument", "pre"]);
const LINE = new Set(["br", "l", "tr"]);
const SKIP = new Set(["script", "style"]);

function headOf(xml: string, fallback: string): LibMeta {
  const head = /<ThML\.head>([\s\S]*?)<\/ThML\.head>/i.exec(xml)?.[1] ?? "";
  const title = strip(/<DC\.Title[^>]*>([\s\S]*?)<\/DC\.Title>/i.exec(head)?.[1] ?? /<title>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "") || fallback;
  const authors: string[] = [];
  for (const m of head.matchAll(/<DC\.Creator([^>]*)>([\s\S]*?)<\/DC\.Creator>/gi)) {
    if (/sub\s*=\s*["']?(?!Author)/i.test(m[1]) && !/sub\s*=\s*["']Author["']/i.test(m[1])) continue;
    const a = strip(m[2]);
    if (a && !authors.includes(a)) authors.push(a);
  }
  const year = strip(/<firstPublished>([\s\S]*?)<\/firstPublished>/i.exec(head)?.[1] ?? "");
  const description = strip(/<description>([\s\S]*?)<\/description>/i.exec(head)?.[1] ?? "");
  return { title, authors, ...(year && { year }), ...(description && { description }) };
}

export function thmlToLibrary(xml: string, fallbackTitle = "Untitled"): ThmlWork {
  const meta = headOf(xml, fallbackTitle);
  const body = /<ThML\.body>([\s\S]*?)<\/ThML\.body>/i.exec(xml)?.[1] ?? "";
  const clean = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t: string) => t.replace(/</g, "&lt;"));

  const entries: LibEntry[] = [{ id: 1, parent: null, level: "work", locator: "", key: "", title: meta.title, text: "" }];
  const parts = new Map<number, string[]>([[1, []]]);
  const stack: { entry: LibEntry; depth: number }[] = [{ entry: entries[0], depth: 0 }];
  let skip = 0;
  let notes = 0;

  const put = (s: string) => {
    const cur = stack[stack.length - 1].entry;
    parts.get(cur.id)!.push(s);
  };
  const breakWith = (b: "\n\n" | "\n") => {
    const arr = parts.get(stack[stack.length - 1].entry.id)!;
    if (!arr.length) return;
    const last = arr[arr.length - 1];
    if (b === "\n\n") arr[arr.length - 1] = last.replace(/[ \t]*\n*$/, "") + "\n\n";
    else if (!last.endsWith("\n")) arr.push("\n");
  };

  const re = /<(\/?)([A-Za-z][\w.]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    if (m[5] !== undefined) {
      if (skip) continue;
      const t = decodeEntities(m[5]).replace(/\s+/g, " ");
      if (t.trim() || (parts.get(stack[stack.length - 1].entry.id)!.length && t === " ")) put(t);
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const attrs = m[3];
    const selfClosing = m[4] === "/";
    if (SKIP.has(name)) {
      if (!selfClosing) skip += closing ? -1 : 1;
      skip = Math.max(0, skip);
      continue;
    }
    if (skip) continue;
    const dm = /^div([1-6])$/.exec(name);
    if (dm) {
      const depth = Number(dm[1]);
      if (!closing) {
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
        const parent = stack[stack.length - 1].entry;
        const title = attr(attrs, "title") || attr(attrs, "shorttitle") || attr(attrs, "id");
        const e: LibEntry = { id: entries.length + 1, parent: parent.id, level: "section", locator: "", key: "", title, text: "" };
        entries.push(e);
        parts.set(e.id, []);
        stack.push({ entry: e, depth });
      } else {
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      }
      continue;
    }
    if (name === "note") {
      if (!closing && !selfClosing) {
        notes++;
        put(" [");
      } else if (closing && notes > 0) {
        notes--;
        put("]");
      }
      continue;
    }
    if (name === "td" || name === "th") {
      if (closing) put(" | ");
      continue;
    }
    if (PARA.has(name)) breakWith("\n\n");
    else if (LINE.has(name)) breakWith("\n");
  }

  for (const e of entries) {
    e.text = (parts.get(e.id) ?? [])
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (e.level === "section" && !e.title) e.title = e.text.slice(0, 60).replace(/\s+/g, " ");
  }
  // a work with no sections is one block of text
  return { meta, entries };
}
