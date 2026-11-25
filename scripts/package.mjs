// Builds the release zips in release/. By default one package for every desktop (Mac Apple silicon, Windows x64, Linux x64);
// BOOKER_PLATFORMS=mac-arm64,win-x64,linux-x64,desktop picks others. Each platform gives:
//   booker-<version>-<platform>.zip           plugin, models, native runtime, install note and the PDF guide
//   booker-<version>-<platform>-no-guide.zip  the same without the guide
// Each holds a folder "booker" to copy into <vault>/.obsidian/plugins/.
// Needs models/, runtime/<platform>/, dictionaries/ and basemap/ in the repo (git-ignored): see scripts/stage-models.mjs, stage-runtime.mjs, stage-dictionaries.mjs and stage-basemap.mjs.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
// only the small, fast search model ships in the zip; the others and the writing model are downloads (Resource manager)
const MODELS = ["bge-micro-v2"];
const ALL = [
  { key: "mac-arm64", runtime: "darwin-arm64", label: "Mac (Apple silicon)", os: "mac" },
  { key: "win-x64", runtime: "win32-x64", label: "Windows (64-bit)", os: "win" },
  { key: "linux-x64", runtime: "linux-x64", label: "Linux (64-bit)", os: "linux" },
  // one build for every desktop: Obsidian loads only the runtime folder that matches the computer (src/semantic/native.ts)
  { key: "desktop", runtimes: ["darwin-arm64", "win32-x64", "linux-x64"], label: "Mac (Apple silicon), Windows (64-bit) and Linux (64-bit)", os: "desktop" },
];
const runtimesOf = (p) => p.runtimes ?? [p.runtime];
const only = process.env.BOOKER_PLATFORMS?.split(",");
// by default only the one package that works on every desktop is built; name others in BOOKER_PLATFORMS to build them too
const PLATFORMS = ALL.filter((p) => (only ?? ["desktop"]).includes(p.key));

for (const p of PLATFORMS) {
  for (const need of [...runtimesOf(p).map((r) => `runtime/${r}/node_modules/onnxruntime-node`), ...MODELS.map((m) => `models/${m}/model_quantized.onnx`)])
    if (!existsSync(need)) throw new Error(`Missing ${need}. Stage the models and runtime first (scripts/stage-models.mjs, scripts/stage-runtime.mjs).`);
}
for (const need of ["oewn-2025.tar.gz", "moby-thesaurus.txt.gz", "LICENSES/Open-English-WordNet-LICENSE.md", "LICENSES/Princeton-WordNet-LICENSE.txt", "LICENSES/Moby-Thesaurus-NOTICE.txt"])
  if (!existsSync(`dictionaries/${need}`)) throw new Error(`Missing dictionaries/${need}. Run scripts/stage-dictionaries.mjs first.`);
for (const need of ["natural-earth-10m.json.gz", "natural-earth-50m.json.gz", "LICENSES/Natural-Earth-NOTICE.txt"])
  if (!existsSync(`basemap/${need}`)) throw new Error(`Missing basemap/${need}. Run scripts/stage-basemap.mjs first.`);
rmSync("release", { recursive: true, force: true });

/** The full licence texts of everything shipped, which MIT, BSD, Apache and the font licence ask to travel with the code. */
const BUNDLED = ["docx", "jszip", "pdf-lib", "@pdf-lib/standard-fonts", "@pdf-lib/upng", "pako", "d3-scale", "d3-array", "d3-format", "d3-interpolate", "d3-time", "d3-time-format", "d3-color", "tslib", "sql.js", "stemmer", "@huggingface/tokenizers", "leaflet", "maplibre-gl"];
function collectLicenses(dir) {
  mkdirSync(`${dir}/LICENSES`, { recursive: true });
  const missing = [];
  for (const name of BUNDLED) {
    const base = `node_modules/${name}`;
    const file = existsSync(base) ? readdirSync(base).find((f) => /^(licen[sc]e|copying)(\.(md|txt|markdown))?$/i.test(f)) : null;
    if (file) cpSync(`${base}/${file}`, `${dir}/LICENSES/${name.replace("/", "-")}-${file}`);
    else missing.push(name);
  }
  for (const f of readdirSync("licenses")) cpSync(`licenses/${f}`, `${dir}/LICENSES/${f}`);
  for (const f of readdirSync("assets/fonts").filter((x) => /^OFL/.test(x))) cpSync(`assets/fonts/${f}`, `${dir}/LICENSES/${f}`);
  for (const f of readdirSync("assets/fonts/initials").filter((x) => /^OFL/.test(x))) cpSync(`assets/fonts/initials/${f}`, `${dir}/LICENSES/${f}`);
  if (missing.length) console.warn(`No licence file found for: ${missing.join(", ")}`);
}

function build(p, withGuide) {
  const name = `booker-${version}-${p.key}${withGuide ? "" : "-no-guide"}`;
  const out = `release/${name}`;
  const dir = `${out}/booker`;
  mkdirSync(dir, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css", "THIRD_PARTY_NOTICES.md", "LICENSE"]) cpSync(f, `${dir}/${f}`);
  collectLicenses(dir);
  for (const m of MODELS) cpSync(`models/${m}`, `${dir}/models/${m}`, { recursive: true });
  // the English dictionary and thesaurus, added to the library the first time Booker starts (their licences travel with them)
  cpSync("dictionaries", `${dir}/dictionaries`, { recursive: true });
  // the world map the Map tab draws (Natural Earth 1:10m, public domain)
  cpSync("basemap", `${dir}/basemap`, { recursive: true });
  for (const r of runtimesOf(p)) cpSync(`runtime/${r}`, `${dir}/runtime/${r}`, { recursive: true });
  // the second copy of the library is the same file: keep one and link the other
  const lib = `${dir}/runtime/darwin-arm64/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64`;
  if (runtimesOf(p).includes("darwin-arm64") && existsSync(`${lib}/libonnxruntime.${"1.31.1"}.dylib`) && existsSync(`${lib}/libonnxruntime.1.dylib`)) {
    rmSync(`${lib}/libonnxruntime.1.dylib`);
    symlinkSync("libonnxruntime.1.31.1.dylib", `${lib}/libonnxruntime.1.dylib`);
  }
  if (withGuide) cpSync("docs/Booker-User-Guide.pdf", `${out}/Booker-User-Guide.pdf`);
  const where = { mac: "<your vault>/.obsidian/plugins/", win: "<your vault>\\.obsidian\\plugins\\", linux: "<your vault>/.obsidian/plugins/", desktop: "<your vault>/.obsidian/plugins/  (Windows: <your vault>\\.obsidian\\plugins\\)" }[p.os];
  const hidden = { mac: "(.obsidian is hidden: in Finder press Cmd+Shift+. to show hidden folders.)", win: "(.obsidian is hidden: in File Explorer choose View > Show > Hidden items.)", linux: "(.obsidian is hidden: in your file manager press Ctrl+H to show hidden folders.)", desktop: "(.obsidian is hidden: Mac Finder Cmd+Shift+. ; Windows File Explorer View > Show > Hidden items; Linux file manager Ctrl+H.)" }[p.os];
  const palette = p.os === "mac" ? "Cmd+P" : p.os === "desktop" ? "Cmd+P (Mac) or Ctrl+P" : "Ctrl+P";
  const chip = { mac: "This package is for Macs with Apple silicon (M1 and later) only.", win: "This package is for 64-bit Windows (Intel or AMD processors).", linux: "This package is for 64-bit Linux (Intel or AMD processors).", desktop: "This package is for Macs with Apple silicon, 64-bit Windows and 64-bit Linux. Intel Macs and phones/tablets get the plugin without Search by meaning." }[p.os];
  writeFileSync(
    `${out}/INSTALL.txt`,
    `Booker ${version} for ${p.label}

1. Quit Obsidian, or leave it open (you will reload it in step 4).
2. Copy the "booker" folder into  ${where}
   ${hidden}
3. Open Obsidian > Settings > Community plugins > turn off Restricted mode if asked.
4. Reload the list, then switch on "Booker".
5. Open the command palette (${palette}) and run "Booker: New project".

Searching by meaning works straight away: the fast model and the engine are inside the folder, and Booker only
goes online when you press a Download button. More models, the writing model and libraries are in the Resource
manager (Settings > Booker > Search by meaning, or the Import card).
The English dictionary and thesaurus (Open English WordNet and the Moby Thesaurus) are inside the folder too; the first time
Booker starts it adds them to your library. Their licences are in the "dictionaries/LICENSES" folder.
The Map tab's world map (Natural Earth) is in the "basemap" folder. Typing a city or zip to find a place needs a one-off download
of place data (Resource manager, "Maps"); nothing else goes online.
${chip}
${withGuide ? "\nThe full guide is Booker-User-Guide.pdf.\n" : ""}`
  );
  execFileSync("zip", ["-rqy", `${name}.zip`, name], { cwd: "release" });
  console.log(`Wrote release/${name}.zip`);
}

for (const p of PLATFORMS) {
  build(p, true);
  build(p, false);
}
