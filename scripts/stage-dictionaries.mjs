#!/usr/bin/env node
// Stages the dictionary and thesaurus that ship inside the plugin zip, into ./dictionaries (git-ignored):
//   oewn-2025.tar.gz        Open English WordNet 2025: the four data files (data.noun, data.verb, data.adj, data.adv)
//   moby-thesaurus.txt.gz   Moby Thesaurus II (Grady Ward, public domain), one headword per line
//   LICENSES/               the licence texts that must travel with the data
// Every download is checked against a pinned SHA-256, so a changed or tampered file stops the build.
// Usage: node scripts/stage-dictionaries.mjs        (needs network, plus the system `unzip` and `tar`)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OEWN = "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition";
const RAW = "https://raw.githubusercontent.com/globalwordnet/english-wordnet/2025-edition";
const SOURCES = {
  oewn: { url: `${OEWN}/english-wordnet-2025.zip`, sha256: "73355e48f8117a24ca9ebc23ed75b35434e6cd21cc9dd3984e80aff5a5f63636" },
  moby: { url: "https://www.gutenberg.org/files/3202/files/mthesaur.txt", sha256: "7c9742b1ed94435a893c0719b426725edb8a5242f8c526a75461bd6cee2dfd32" },
  oewnLicence: { url: `${RAW}/LICENSE.md`, sha256: "672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb" },
  princetonLicence: { url: `${RAW}/WNDB_License.txt`, sha256: "df30ec18fbabcdaf031b79ea026d3e6b959010cffe6dd7be9ac137822175b904" },
};

const MOBY_NOTICE = `Moby Thesaurus II, by Grady Ward.

"Public Domain material by grant from the author, January, 2001."
(from the Moby Thesaurus II documentation notes, Project Gutenberg eBook #3202,
https://www.gutenberg.org/ebooks/3202 )

The file shipped here, moby-thesaurus.txt.gz, is the unabridged Moby main thesaurus file
(mthesaur.txt) compressed with gzip and otherwise unchanged.
`;

const sha = (b) => createHash("sha256").update(b).digest("hex");
async function get(key) {
  const { url, sha256 } = SOURCES[key];
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== sha256) throw new Error(`${url}: checksum differs from the pinned one (got ${sha(buf)}). Refusing to use it.`);
  return buf;
}

const out = "dictionaries";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/LICENSES`, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "booker-dicts-"));
try {
  // Open English WordNet: keep only the four data files the importer reads
  writeFileSync(join(work, "oewn.zip"), await get("oewn"));
  execFileSync("unzip", ["-q", "-j", join(work, "oewn.zip"), "oewn2025/data.noun", "oewn2025/data.verb", "oewn2025/data.adj", "oewn2025/data.adv", "-d", join(work, "data")]);
  execFileSync("tar", ["-czf", `${out}/oewn-2025.tar.gz`, "-C", join(work, "data"), "data.noun", "data.verb", "data.adj", "data.adv"]);
  // Moby
  writeFileSync(`${out}/moby-thesaurus.txt.gz`, gzipSync(await get("moby"), { level: 9 }));
  // licences, verbatim
  writeFileSync(`${out}/LICENSES/Open-English-WordNet-LICENSE.md`, await get("oewnLicence"));
  writeFileSync(`${out}/LICENSES/Princeton-WordNet-LICENSE.txt`, await get("princetonLicence"));
  writeFileSync(`${out}/LICENSES/Moby-Thesaurus-NOTICE.txt`, MOBY_NOTICE);
} finally {
  rmSync(work, { recursive: true, force: true });
}
for (const f of ["oewn-2025.tar.gz", "moby-thesaurus.txt.gz", "LICENSES/Open-English-WordNet-LICENSE.md", "LICENSES/Princeton-WordNet-LICENSE.txt", "LICENSES/Moby-Thesaurus-NOTICE.txt"]) {
  if (!existsSync(`${out}/${f}`)) throw new Error(`Missing ${out}/${f}`);
  console.log(`${out}/${f}  ${(readFileSync(`${out}/${f}`).length / 1048576).toFixed(1)} MB`);
}
