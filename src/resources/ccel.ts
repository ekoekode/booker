/** CCEL's catalogue: the page that lists every work available as ThML, and where each work's ThML file lives. Pure. */

export interface CcelWork {
  /** the author's CCEL id, such as schaff */
  author: string;
  /** the work's id, such as anf01 */
  work: string;
  title: string;
  authorName: string;
}

export const CCEL_LIST_URL = "https://ccel.org/index/format/ThML";

export const ccelId = (w: CcelWork): string => `${w.author}/${w.work}`;
/** CCEL keeps files under the first letter of the author id. */
export const ccelXmlUrl = (w: CcelWork): string => `https://ccel.org/ccel/${w.author[0]}/${w.author}/${w.work}.xml`;
export const ccelPageUrl = (w: CcelWork): string => `https://ccel.org/ccel/${w.author}/${w.work}`;

const decode = (s: string) => s.replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const tidy = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** The works on the "All Works in Format ThML" page, in the order listed, without repeats. */
export function parseCcelList(html: string): CcelWork[] {
  const out: CcelWork[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="\/ccel\/([^\/"]+)\/([^\/".]+)\.html"[^>]*>([\s\S]*?)<\/a>\s*(?:<span[^>]*class="authorName"[^>]*>\s*\(?\s*<a[^>]*>([\s\S]*?)<\/a>)?/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const id = `${m[1]}/${m[2]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ author: m[1], work: m[2], title: tidy(m[3]), authorName: tidy(m[4] ?? "") });
  }
  return out;
}

/** A safe file name for a work's library: "Author - Title". */
export function ccelFileName(w: CcelWork): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  const name = `${clean(w.authorName || w.author)} - ${clean(w.title)}`.slice(0, 120).trim();
  return `${name}.nlib`;
}

/** How long a set of works takes at CCEL's pace, in seconds (one request each, plus a little for the download). */
export const estimateSeconds = (count: number, gapMs = 10000): number => Math.round((count * (gapMs + 1500)) / 1000);

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} minutes`;
  const h = seconds / 3600;
  return `${h.toFixed(h < 10 ? 1 : 0)} hours`;
}
