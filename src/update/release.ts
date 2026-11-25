/** Reading GitHub's "latest release" answer and deciding what to install. Pure: no network, no disk. */

export const REPO = "ekoekode/booker";
export const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** "sha256:<hex>" as GitHub reports it, when it does */
  digest?: string;
}

export interface Release {
  version: string;
  notes: string;
  page: string;
  assets: ReleaseAsset[];
}

/** 0.70.7 -> [0, 70, 7]; anything that is not a plain dotted version gives null. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Positive when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function parseRelease(json: unknown): Release | null {
  const r = json as { tag_name?: unknown; body?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (!r || typeof r.tag_name !== "string" || r.draft || r.prerelease) return null;
  const v = parseVersion(r.tag_name);
  if (!v) return null;
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(r.assets))
    for (const a of r.assets as Array<Record<string, unknown>>)
      if (typeof a.name === "string" && typeof a.browser_download_url === "string") assets.push({ name: a.name, url: a.browser_download_url, size: Number(a.size) || 0, ...(typeof a.digest === "string" && { digest: a.digest }) });
  return { version: v.join("."), notes: typeof r.body === "string" ? r.body : "", page: typeof r.html_url === "string" ? r.html_url : RELEASES_PAGE, assets };
}

/** The zip to install: the desktop build without the guide (smaller), else the one with it. */
export function pickAsset(r: Release): ReleaseAsset | null {
  return r.assets.find((a) => a.name === `booker-${r.version}-desktop-no-guide.zip`) ?? r.assets.find((a) => a.name === `booker-${r.version}-desktop.zip`) ?? null;
}

/** What is replaced, and what is never touched: the program files and the runtime for this computer only. Books, Bibles, libraries, downloaded models and settings are not in this list. */
const PROGRAM = [/^(main\.js|manifest\.json|styles\.css|LICENSE|THIRD_PARTY_NOTICES\.md)$/, /^LICENSES\//, /^dictionaries\//, /^basemap\//, /^models\/bge-micro-v2\//];

export interface Planned {
  /** the name inside the zip */
  from: string;
  /** where it goes, relative to the plugin folder */
  to: string;
}

/** Which files of the zip to write. `platformKey` is like darwin-arm64. The zip holds `<name>/booker/...`. */
export function planInstall(entries: string[], platformKey: string): Planned[] {
  const out: Planned[] = [];
  for (const from of entries) {
    if (from.endsWith("/")) continue;
    const m = /^[^/]+\/booker\/(.+)$/.exec(from);
    if (!m) continue;
    const to = m[1];
    if (to.split("/").some((part) => part === ".." || part === "")) continue;
    const runtime = /^runtime\/([^/]+)\//.exec(to);
    const ok = runtime ? runtime[1] === platformKey : PROGRAM.some((re) => re.test(to));
    if (ok && to !== "data.json") out.push({ from, to });
  }
  // the three files Obsidian reads to start the plugin go last, so a stop part-way leaves the old plugin working
  const last = (t: string) => (t === "main.js" ? 3 : t === "manifest.json" ? 2 : t === "styles.css" ? 1 : 0);
  return out.sort((a, b) => last(a.to) - last(b.to));
}

/** The sha256 in a GitHub "digest" field, or null. */
export function digestOf(a: ReleaseAsset): string | null {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(a.digest ?? "");
  return m ? m[1].toLowerCase() : null;
}
