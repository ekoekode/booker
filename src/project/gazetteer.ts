import type { LatLng } from "./geo";

/**
 * Turn typed places ("Paris, Texas", "Springfield IL", "75001", "SW1A 1AA", "Lyon, France") into coordinates, from GeoNames data the user
 * has downloaded. Pure: it reads text it is given and never touches the disk or the network.
 *
 *   cities15000.txt       every place of 15,000 people or more (tab separated; name, ascii name, position, country, state code, population)
 *   admin1CodesASCII.txt  state / region names by code ("US.TX" -> Texas)
 *   countryInfo.txt       country names by ISO code
 *   postal codes          one line per code (country, code, place, state name, state code, ... latitude, longitude)
 *
 * GeoNames data is CC BY 4.0 (https://www.geonames.org).
 */

export interface PlaceHit extends LatLng {
  /** "Paris, Texas, United States" */
  label: string;
  kind: "city" | "postal";
  country: string;
  cc: string;
  /** rank, higher is a better match */
  score: number;
}

export interface CityRow {
  name: string;
  /** ASCII form of the name */
  asc: string;
  cc: string;
  /** state or region code */
  a1: string;
  lat: number;
  lng: number;
  pop: number;
}

export interface CityIndex {
  rows: CityRow[];
  /** normalised name (and ASCII name) to rows */
  byName: Map<string, CityRow[]>;
  countries: Map<string, string>;
  admin1: Map<string, string>;
  /** normalised country name or alias to ISO code */
  ccByName: Map<string, string>;
}

/** lower case, no accents, punctuation to single spaces */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIASES: Record<string, string> = {
  usa: "US",
  "u s a": "US",
  "u s": "US",
  america: "US",
  "united states of america": "US",
  uk: "GB",
  "u k": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  britain: "GB",
  "great britain": "GB",
  holland: "NL",
  "south korea": "KR",
  russia: "RU",
};

/** When a code exists in many countries and the author gave no country, these come first (most books are set in them). */
const COUNTRY_ORDER = ["US", "GB", "CA", "AU", "DE", "FR", "IE", "NZ", "ES", "IT", "NL", "BR", "IN", "JP", "MX"];
const countryBonus = (cc: string): number => {
  const i = COUNTRY_ORDER.indexOf(cc);
  return i < 0 ? 0 : (COUNTRY_ORDER.length - i) * 0.3;
};

/** "Downtown Toronto (CN Tower / King and Spadina / ...)" to "Downtown Toronto" */
const shortName = (s: string): string => s.replace(/\s*\(.*$/, "").trim() || s;

export function parseCountries(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const c = line.split("\t");
    if (c[0] && c[4]) out.set(c[0], c[4]);
  }
  return out;
}

export function parseAdmin1(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const c = line.split("\t");
    if (c[0] && c[1]) out.set(c[0], c[1]);
  }
  return out;
}

export function buildCityIndex(citiesText: string, countries: Map<string, string>, admin1: Map<string, string>): CityIndex {
  const rows: CityRow[] = [];
  const byName = new Map<string, CityRow[]>();
  const add = (k: string, r: CityRow) => {
    const list = byName.get(k);
    if (!list) byName.set(k, [r]);
    else if (!list.includes(r)) list.push(r);
  };
  for (const line of citiesText.split("\n")) {
    if (!line) continue;
    const c = line.split("\t");
    const lat = parseFloat(c[4]);
    const lng = parseFloat(c[5]);
    if (!c[1] || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const r: CityRow = { name: c[1], asc: c[2] || c[1], cc: c[8] ?? "", a1: c[10] ?? "", lat, lng, pop: parseInt(c[14], 10) || 0 };
    rows.push(r);
    add(norm(r.name), r);
    add(norm(r.asc), r);
  }
  const ccByName = new Map<string, string>();
  for (const [cc, name] of countries) ccByName.set(norm(name), cc);
  for (const [alias, cc] of Object.entries(ALIASES)) if (countries.has(cc)) ccByName.set(alias, cc);
  return { rows, byName, countries, admin1, ccByName };
}

const countryName = (ix: CityIndex, cc: string) => ix.countries.get(cc) ?? cc;
const stateName = (ix: CityIndex, cc: string, a1: string) => (a1 ? ix.admin1.get(`${cc}.${a1}`) ?? "" : "");

/** How well each extra word (state, country) of the query fits a place. Each word that fits adds to the score, each that does not subtracts. */
function extraScore(ix: CityIndex, cc: string, a1: string, extras: string[]): number {
  let s = 0;
  const state = norm(stateName(ix, cc, a1));
  const country = norm(countryName(ix, cc));
  for (const e of extras) {
    const n = norm(e);
    if (!n) continue;
    const ccHit = ix.ccByName.get(n) === cc || n === cc.toLowerCase();
    const stateHit = (state !== "" && n === state) || (a1 !== "" && n === a1.toLowerCase());
    const countryText = country !== "" && n === country;
    s += ccHit || stateHit || countryText ? 20 : -40;
  }
  return s;
}

/** All ways to read "Paris Texas USA" or "Paris, Texas, USA" as a name plus extra words. */
function splits(query: string): Array<{ name: string; extras: string[] }> {
  const parts = query.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return [{ name: parts[0], extras: parts.slice(1) }];
  const words = (parts[0] ?? "").split(/\s+/).filter(Boolean);
  const out: Array<{ name: string; extras: string[] }> = [];
  for (let k = words.length; k >= 1; k--) {
    const rest = words.slice(k);
    // the rest may be one word each ("Springfield IL USA") or one phrase ("Rio de Janeiro Brazil": name is the first k words)
    out.push({ name: words.slice(0, k).join(" "), extras: rest.length ? [rest.join(" ")] : [] });
    if (rest.length > 1) out.push({ name: words.slice(0, k).join(" "), extras: rest });
  }
  return out;
}

export function searchCities(ix: CityIndex, query: string, limit = 8): PlaceHit[] {
  const seen = new Map<CityRow, number>();
  for (const sp of splits(query)) {
    const rows = ix.byName.get(norm(sp.name));
    if (!rows) continue;
    for (const r of rows) {
      const score = Math.log10(r.pop + 10) * 4 + extraScore(ix, r.cc, r.a1, sp.extras) + (sp.extras.length ? 0 : 0);
      // a longer name that matched is a better reading than one that left words over
      const bonus = sp.extras.length === 0 ? 5 : 0;
      const total = score + bonus;
      if (!seen.has(r) || (seen.get(r) as number) < total) seen.set(r, total);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([r, score]) => {
      const st = stateName(ix, r.cc, r.a1);
      const cn = countryName(ix, r.cc);
      return { lat: r.lat, lng: r.lng, label: [r.name, st, cn].filter(Boolean).join(", "), kind: "city" as const, country: cn, cc: r.cc, score };
    });
}

/** Postal codes for one query. `text` is the postal file; it is searched line by line, never parsed whole. */
export function searchPostal(text: string, query: string, ix: CityIndex | null, limit = 8): PlaceHit[] {
  const words = query.split(/[,\s]+/).filter(Boolean);
  if (!words.some((w) => /\d/.test(w))) return [];
  const extras: string[] = [];
  const codeWords: string[] = [];
  // the code is the run of words that hold digits (and the letters around them: "SW1A 1AA", "M5V 3L9"), the rest are state or country
  words.forEach((w, i) => {
    const near = /\d/.test(w) || (i > 0 && /\d/.test(words[i - 1]) && /^[A-Za-z0-9]{3}$/.test(w)) || (i < words.length - 1 && /\d/.test(words[i + 1]) && /^[A-Za-z]{1,2}\d/.test(words[i + 1]) && /^[A-Za-z0-9]{2,4}$/.test(w));
    (near ? codeWords : extras).push(w);
  });
  const full = codeWords.join(" ").toUpperCase();
  const tries = [...new Set([full, full.replace(/\s+/g, ""), codeWords[0]?.toUpperCase() ?? "", full.replace(/\s+/g, "").slice(0, 3)])].filter((c) => c.length >= 3 || /^\d{3,}$/.test(c));
  const hits: PlaceHit[] = [];
  for (const [order, code] of tries.entries()) {
    const needle = `\t${code}\t`;
    let at = text.indexOf(needle);
    let guard = 0;
    while (at !== -1 && guard++ < 400) {
      const start = text.lastIndexOf("\n", at) + 1;
      const end = text.indexOf("\n", at);
      const c = text.slice(start, end === -1 ? undefined : end).split("\t");
      if (c[1] === code) {
        const lat = parseFloat(c[9]);
        const lng = parseFloat(c[10]);
        const cc = c[0];
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const cn = ix ? countryName(ix, cc) : cc;
          let score = 50 - order * 8 + countryBonus(cc);
          for (const e of extras) {
            const n = norm(e);
            const ok = n === cc.toLowerCase() || ix?.ccByName.get(n) === cc || n === norm(cn) || n === norm(c[3] ?? "") || n === (c[4] ?? "").toLowerCase();
            score += ok ? 20 : -40;
          }
          hits.push({ lat, lng, label: [shortName(c[2] ?? ""), c[3], cn].filter(Boolean).join(", ") + ` (${code})`, kind: "postal", country: cn, cc, score });
        }
      }
      at = text.indexOf(needle, at + needle.length);
    }
    if (hits.length) break; // the full code matched; shorter forms are only for codes stored in part (UK, Canada)
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface GazetteerSources {
  cities: CityIndex | null;
  /** the postal file's text, loaded only when the query holds a digit */
  postal: (() => string | null) | null;
}

/** Best readings of what the author typed, best first. Empty when nothing matches. */
export function geocode(src: GazetteerSources, query: string, limit = 8): PlaceHit[] {
  const q = (query ?? "").trim();
  if (!q) return [];
  const hits: PlaceHit[] = [];
  if (src.postal && /\d/.test(q)) {
    const text = src.postal();
    if (text) hits.push(...searchPostal(text, q, src.cities, limit));
  }
  if (src.cities) hits.push(...searchCities(src.cities, q, limit));
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A good-enough reading: a clear winner, or the only hit. Otherwise the caller should ask. */
export function pickConfident(hits: PlaceHit[]): PlaceHit | null {
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  return hits[0].score - hits[1].score >= 15 ? hits[0] : null;
}
