#!/usr/bin/env node
// Usage: node scripts/install.mjs "<path to your vault>" [--enable] [--init]
// Refuses a folder without .obsidian unless --init is given.
// Copies the built plugin into <vault>/.obsidian/plugins/booker/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vault = process.argv[2];
const enable = process.argv.includes("--enable");
const init = process.argv.includes("--init");
if (!vault) {
  console.error('Usage: node scripts/install.mjs "<vault path>" [--enable]');
  process.exit(1);
}
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  if (!existsSync(join(root, f))) {
    console.error(`Missing ${f}. Run "npm run build" first.`);
    process.exit(1);
  }
}
if (!existsSync(join(vault, ".obsidian")) && !init) {
  console.error(`"${vault}" has no .obsidian folder, so it does not look like an Obsidian vault. Pass --init to install anyway.`);
  process.exit(1);
}
const dest = join(vault, ".obsidian", "plugins", "booker");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join(root, f), join(dest, f));
console.log(`Installed Booker to ${dest}`);

if (enable) {
  const file = join(vault, ".obsidian", "community-plugins.json");
  let list = [];
  if (existsSync(file)) {
    try {
      list = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`Could not parse ${file} (${e.message}). Not overwriting it: fix or delete the file, then run again.`);
      process.exit(1);
    }
    if (!Array.isArray(list)) {
      console.error(`${file} is not a JSON array. Not overwriting it.`);
      process.exit(1);
    }
  }
  if (!list.includes("booker")) list.push("booker");
  writeFileSync(file, JSON.stringify(list, null, 2));
  console.log("Enabled in community-plugins.json");
}
