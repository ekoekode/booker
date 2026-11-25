import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Booker goes online only when the user presses a Download button. All of that is in src/resources/nodeIO.ts, the one place allowed to
 * use the https module. Nothing else may touch the network, and nobody may use fetch, sockets or requestUrl at all.
 */
const DOWNLOADER = join("src", "resources", "nodeIO.ts");
const BANNED: Array<[string, RegExp]> = [
  ["fetch()", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["WebSocket", /\bWebSocket\b/],
  ["EventSource", /\bEventSource\b/],
  ["sendBeacon", /sendBeacon/],
  ["Obsidian requestUrl", /\brequestUrl\b/],
  ["network module", /(?:from\s+|require\()\s*["'](?:node:)?(?:https?|net|tls|dgram|http2)["']/],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function offences(text: string, allowModule = false): string[] {
  return BANNED.filter(([label, re]) => !(allowModule && label === "network module") && re.test(text)).map(([label]) => label);
}

describe("no network access", () => {
  it("the source tree has no network calls", () => {
    const found: string[] = [];
    for (const file of walk("src")) {
      const bad = offences(readFileSync(file, "utf8"), file === DOWNLOADER);
      if (bad.length) found.push(`${file}: ${bad.join(", ")}`);
    }
    expect(found).toEqual([]);
  });

  it("the built bundle has no network calls", () => {
    if (!existsSync("main.js")) return; // only present after `npm run build`
    const bundle = readFileSync("main.js", "utf8");
    expect(offences(bundle, true)).toEqual([]);
    // the downloader's own use of https, and no other module
    expect((bundle.match(/require\(["'](?:node:)?(?:http|net|tls|dgram|http2)["']\)/g) ?? []).length).toBe(0);
  });
});
