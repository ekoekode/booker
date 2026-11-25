#!/usr/bin/env node
// Downloads Booker's models, CCEL / Tertullian.org / Fordham works and the Church Fathers repositories from a terminal, with the same polite fetcher the app uses
// (waits between requests, follows robots.txt, resumes, verifies checksums). Run with no arguments for help.
//   node scripts/fetch-resources.mjs list
//   node scripts/fetch-resources.mjs models --plugin "<vault>/.obsidian/plugins/booker"
//   node scripts/fetch-resources.mjs site ccel|tertullian|fordham --out ~/libs [--match augustine] [--limit 20] [--dry-run]
//   node scripts/fetch-resources.mjs archive hcf-writings|hcf-commentaries --out ~/libs
import esbuild from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "scripts", ".fetch-resources.bundle.mjs");
await esbuild.build({
  entryPoints: [join(root, "src/resources/cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "error",
  loader: { ".wasm": "binary" },
  banner: { js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
});
await import(pathToFileURL(out).href);
