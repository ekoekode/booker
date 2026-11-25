import { describe, expect, it } from "vitest";
import { compareVersions, digestOf, parseRelease, pickAsset, planInstall } from "../src/update/release";

const json = (over: object = {}) => ({
  tag_name: "v0.71.0",
  body: "Notes",
  html_url: "https://github.com/ekoekode/booker/releases/tag/v0.71.0",
  draft: false,
  prerelease: false,
  assets: [
    { name: "booker-0.71.0-desktop.zip", browser_download_url: "https://example/a.zip", size: 100, digest: `sha256:${"a".repeat(64)}` },
    { name: "booker-0.71.0-desktop-no-guide.zip", browser_download_url: "https://example/b.zip", size: 90 },
  ],
  ...over,
});

describe("update release", () => {
  it("compares versions numerically", () => {
    expect(compareVersions("0.71.0", "0.70.7")).toBeGreaterThan(0);
    expect(compareVersions("0.70.10", "0.70.9")).toBeGreaterThan(0);
    expect(compareVersions("0.70.7", "0.70.7")).toBe(0);
    expect(compareVersions("junk", "0.70.7")).toBe(0);
  });

  it("reads a release and ignores drafts and pre-releases", () => {
    expect(parseRelease(json())?.version).toBe("0.71.0");
    expect(parseRelease(json({ draft: true }))).toBeNull();
    expect(parseRelease(json({ prerelease: true }))).toBeNull();
    expect(parseRelease(json({ tag_name: "nightly" }))).toBeNull();
  });

  it("prefers the smaller no-guide zip and reads the checksum", () => {
    const r = parseRelease(json())!;
    expect(pickAsset(r)?.name).toBe("booker-0.71.0-desktop-no-guide.zip");
    expect(digestOf(r.assets[0])).toBe("a".repeat(64));
    expect(digestOf(r.assets[1])).toBeNull();
  });

  it("installs only program files and this computer's runtime, never data", () => {
    const n = "booker-0.71.0-desktop-no-guide";
    const plan = planInstall(
      [`${n}/INSTALL.txt`, `${n}/booker/main.js`, `${n}/booker/manifest.json`, `${n}/booker/styles.css`, `${n}/booker/data.json`, `${n}/booker/runtime/darwin-arm64/node_modules/x.node`, `${n}/booker/runtime/win32-x64/node_modules/x.node`, `${n}/booker/models/bge-micro-v2/model.json`, `${n}/booker/models/bge-small-en-v1.5/model.json`, `${n}/booker/LICENSES/a.txt`, `${n}/booker/../evil.js`, `${n}/booker/wordstudy/John.json`, `${n}/booker/`],
      "darwin-arm64"
    ).map((p) => p.to);
    expect(plan).toEqual(expect.arrayContaining(["LICENSES/a.txt", "models/bge-micro-v2/model.json", "runtime/darwin-arm64/node_modules/x.node"]));
    expect(plan).not.toContain("data.json");
    expect(plan).not.toContain("runtime/win32-x64/node_modules/x.node");
    expect(plan).not.toContain("models/bge-small-en-v1.5/model.json");
    expect(plan.some((p) => p.includes("wordstudy") || p.includes(".."))).toBe(false);
    // the files Obsidian starts the plugin from come last, main.js the very last
    expect(plan.slice(-3)).toEqual(["styles.css", "manifest.json", "main.js"]);
  });
});
