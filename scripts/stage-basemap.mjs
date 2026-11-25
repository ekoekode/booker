#!/usr/bin/env node
// Stages the world basemap that ships inside the plugin zip, into ./basemap (git-ignored):
//   natural-earth-10m.json.gz   Natural Earth 1:10m land, lakes, rivers, country and state borders as one compact GeoJSON bundle (WebGL map)
//   natural-earth-50m.json.gz   the same layers at 1:50m, lighter, for the compatible map that draws without WebGL
//   LICENSES/Natural-Earth-NOTICE.txt
// Every download is checked against a pinned SHA-256, so a changed or tampered file stops the build.
// Usage: node scripts/stage-basemap.mjs        (needs network)
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson";
// keep: which layer of the output each file feeds; decimals: coordinate precision (3 = about 100 m, far finer than a story map needs)
const SOURCES_10M = [
  { key: "land", file: "ne_10m_land", sha256: "1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416", decimals: 2 },
  { key: "lakes", file: "ne_10m_lakes", sha256: "2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9", decimals: 2 },
  { key: "rivers", file: "ne_10m_rivers_lake_centerlines", sha256: "bb854a900ecbd3b408df46d5e16e3e0f974ba55993f9d8b5c26e855273c0905a", decimals: 2 },
  { key: "borders", file: "ne_10m_admin_0_boundary_lines_land", sha256: "74d9c16229c095fde65943a9919e337682f044bcebccb120764f38edf3b70f4a", decimals: 2 },
  { key: "states", file: "ne_10m_admin_1_states_provinces_lines", sha256: "1a1f30ccaaf4cc9c4bde34266f0b8cbb955d3a4cf254b756912255f2ec7c75b6", decimals: 2 },
];
const SOURCES_50M = [
  { key: "land", file: "ne_50m_land", sha256: "e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b", decimals: 2 },
  { key: "lakes", file: "ne_50m_lakes", sha256: "d350b75978b26fe839b797c2c529b2fb8f47fb3983c03f4964e36d5df9378a52", decimals: 2 },
  { key: "rivers", file: "ne_50m_rivers_lake_centerlines", sha256: "f286e0ce978fde999ca2d7a78c764be08542e19b63cded52b05c12d5173ccc51", decimals: 2 },
  { key: "borders", file: "ne_50m_admin_0_boundary_lines_land", sha256: "2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48", decimals: 2 },
  { key: "states", file: "ne_50m_admin_1_states_provinces_lines", sha256: "72cca93c850d412628a5da4bc5ebfe21ba4d376eb34611bde6b623ee73f0fdcf", decimals: 2 },
];

const NOTICE = `Natural Earth: free vector and raster map data, https://www.naturalearthdata.com

"Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com."
Natural Earth is in the public domain: "All versions of Natural Earth raster + vector map data found on this website
are in the public domain. You may use the maps in any manner, including modifying the content and design,
electronic dissemination, and offset printing. The primary authors, Tom Patterson and Nathaniel Vaughn Kelso,
and all other contributors renounce all financial claim to the maps and invite you to use them for personal,
educational, and commercial purposes. No permission is needed to use Natural Earth. Crediting the authors is
unnecessary."

The files shipped here, natural-earth-10m.json.gz and natural-earth-50m.json.gz, are the 1:10m and 1:50m physical and cultural vectors listed in
scripts/stage-basemap.mjs, with properties removed and coordinates rounded, gzip-compressed.
`;

const sha = (b) => createHash("sha256").update(b).digest("hex");

async function get({ file, sha256 }) {
  const url = `${BASE}/${file}.geojson`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== sha256) throw new Error(`${url}: checksum differs from the pinned one (got ${sha(buf)}). Refusing to use it.`);
  return JSON.parse(buf.toString("utf8"));
}

/** Drop consecutive points that collapse onto the same rounded position, and runs shorter than a line or ring. */
function round(coords, k, minLen) {
  const out = [];
  for (const [x, y] of coords) {
    const p = [Math.round(x * k) / k, Math.round(y * k) / k];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= minLen ? out : null;
}

function squash(geom, decimals) {
  const k = 10 ** decimals;
  const line = (c) => round(c, k, 2);
  const ring = (c) => round(c, k, 4);
  switch (geom.type) {
    case "LineString": { const c = line(geom.coordinates); return c && { type: "LineString", coordinates: c }; }
    case "MultiLineString": { const c = geom.coordinates.map(line).filter(Boolean); return c.length && { type: "MultiLineString", coordinates: c }; }
    case "Polygon": { const c = geom.coordinates.map(ring); return c[0] ? { type: "Polygon", coordinates: c.filter(Boolean) } : null; }
    case "MultiPolygon": {
      const polys = geom.coordinates.map((p) => { const c = p.map(ring); return c[0] ? c.filter(Boolean) : null; }).filter(Boolean);
      return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
    }
    default: return null;
  }
}

const out = "basemap";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/LICENSES`, { recursive: true });
async function build(sources, name) {
  const bundle = {};
  for (const src of sources) {
    const fc = await get(src);
    const features = [];
    for (const f of fc.features) {
      const g = f.geometry && squash(f.geometry, src.decimals);
      if (g) features.push({ type: "Feature", properties: {}, geometry: g });
    }
    bundle[src.key] = { type: "FeatureCollection", features };
    console.log(`${name} ${src.key}: ${features.length} features`);
  }
  const json = JSON.stringify(bundle);
  writeFileSync(`${out}/${name}`, gzipSync(Buffer.from(json), { level: 9 }));
  console.log(`${name}: uncompressed ${(json.length / 1048576).toFixed(1)} MB`);
}
await build(SOURCES_10M, "natural-earth-10m.json.gz");
await build(SOURCES_50M, "natural-earth-50m.json.gz");
writeFileSync(`${out}/LICENSES/Natural-Earth-NOTICE.txt`, NOTICE);
for (const f of ["natural-earth-10m.json.gz", "natural-earth-50m.json.gz", "LICENSES/Natural-Earth-NOTICE.txt"]) {
  if (!existsSync(`${out}/${f}`)) throw new Error(`Missing ${out}/${f}`);
  console.log(`${out}/${f}  ${(readFileSync(`${out}/${f}`).length / 1048576).toFixed(2)} MB`);
}
