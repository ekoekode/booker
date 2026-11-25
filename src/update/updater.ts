import { App, Modal, Notice, Platform, Setting } from "obsidian";
import type BookerPlugin from "../main";
import { compareVersions, digestOf, LATEST_URL, parseRelease, pickAsset, planInstall, RELEASES_PAGE, type Release } from "./release";
import { platformKey } from "../semantic/native";
import { ConfirmModal } from "../ui";

export type CheckResult = { kind: "newer"; release: Release } | { kind: "current"; version: string } | { kind: "error"; message: string };

const DAY = 24 * 60 * 60 * 1000;

/** The one-time question: check for updates by itself, once a day? Closing it with Esc leaves the question for next time. */
class AskDaily extends Modal {
  constructor(app: App, private answer: (yes: boolean) => void) {
    super(app);
  }
  onOpen() {
    this.contentEl.createEl("h3", { text: "Check for Booker updates automatically?" });
    this.contentEl.createEl("p", { text: "Booker can look for a newer version once a day when Obsidian starts. It only asks GitHub for the newest release number, and it never installs anything without asking you first. You can change this later under Settings > Booker > Updates." });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("No, I'll check myself").onClick(() => (this.close(), this.answer(false))))
      .addButton((b) => b.setButtonText("Yes, once a day").setCta().onClick(() => (this.close(), this.answer(true))));
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Looking for a newer Booker on GitHub and installing it over the old one, without touching books, Bibles, libraries or settings. */
export class Updater {
  private busy = false;

  constructor(private plugin: BookerPlugin) {}

  get current(): string {
    return this.plugin.manifest.version;
  }

  async check(): Promise<CheckResult> {
    if (!this.plugin.resources.available) return { kind: "error", message: `Checking needs the desktop app. See ${RELEASES_PAGE} for the newest version.` };
    try {
      const bytes = await this.plugin.resources.fetchBytes(LATEST_URL, { max: 2 * 1024 * 1024 });
      const release = parseRelease(JSON.parse(new TextDecoder().decode(bytes)));
      if (!release) return { kind: "error", message: "GitHub has no published release yet." };
      return compareVersions(release.version, this.current) > 0 ? { kind: "newer", release } : { kind: "current", version: this.current };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Run a little after Obsidian starts: ask once whether to check daily, and if yes, look at most once a day and offer an update. Never installs by itself. */
  async startup() {
    if (!this.plugin.resources.available) return;
    const st = this.plugin.settings;
    if (st.updateCheck === "ask") {
      new AskDaily(this.plugin.app, (yes) => {
        st.updateCheck = yes ? "on" : "off";
        void this.plugin.persist();
        if (yes) void this.daily();
      }).open();
      return;
    }
    if (st.updateCheck === "on") await this.daily();
  }

  private async daily() {
    const st = this.plugin.settings;
    if (Date.now() - (st.lastUpdateCheck || 0) < DAY) return;
    const r = await this.check();
    // a failed look (no internet, GitHub busy) is not counted, so it is tried again next start
    if (r.kind === "error") return;
    st.lastUpdateCheck = Date.now();
    void this.plugin.persist();
    if (r.kind === "newer") this.offer(r.release, () => undefined);
  }

  /** The button: check, say what was found, and offer to install. `say` shows the result where the button is. */
  async checkAndOffer(say: (text: string) => void = () => undefined) {
    if (this.busy) return;
    say("Checking…");
    const r = await this.check();
    if (r.kind === "error") return say(`Could not check. ${r.message}`), void new Notice(`Booker: could not check for updates. ${r.message}`);
    if (r.kind === "current") return say(`Booker ${r.version} is the newest version.`), void new Notice(`Booker: ${r.version} is up to date.`);
    say(`Booker ${r.release.version} is available (you have ${this.current}).`);
    this.offer(r.release, say);
  }

  private offer(rel: Release, say: (text: string) => void) {
    const notes = rel.notes.trim().slice(0, 600);
    new ConfirmModal(this.plugin.app, `Update to Booker ${rel.version}?`, `You have ${this.current}.${notes ? `\n\n${notes}` : ""}\n\nBooker downloads the new version and replaces only its own program files. Your books, Bibles, libraries, downloaded models and settings are not touched. Obsidian then reloads Booker.`, "Update", () => void this.install(rel, say)).open();
  }

  async install(rel: Release, say: (text: string) => void = () => undefined) {
    if (this.busy) return;
    const asset = pickAsset(rel);
    if (!asset) return void new Notice(`Booker: release ${rel.version} has no desktop download. See ${rel.page}.`);
    if (!this.plugin.resources.available) return void new Notice(`Booker: updating needs the desktop app. See ${rel.page}.`);
    this.busy = true;
    const tracker = this.plugin.tasks;
    const task = tracker.add(`Updating Booker to ${rel.version}`, { state: "running" });
    try {
      tracker.update(task, { detail: `Downloading ${asset.name}` });
      const bytes = await this.plugin.resources.fetchBytes(asset.url, { max: 600 * 1024 * 1024 });
      const want = digestOf(asset);
      if (want) {
        tracker.update(task, { detail: "Checking the download" });
        const got = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer))].map((b) => b.toString(16).padStart(2, "0")).join("");
        if (got !== want) throw new Error("The download does not match its checksum, so nothing was changed.");
      }
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(bytes);
      const plan = planInstall(Object.keys(zip.files), platformKey());
      const manifestEntry = plan.find((p) => p.to === "manifest.json");
      if (!manifestEntry) throw new Error("The download has no plugin in it, so nothing was changed.");
      const inside = JSON.parse(await zip.files[manifestEntry.from].async("string")) as { version?: string; id?: string };
      if (inside.id !== "booker" || inside.version !== rel.version) throw new Error("The download is not the release it claims to be, so nothing was changed.");
      const a = this.plugin.app.vault.adapter;
      const dir = this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/booker`;
      const made = new Set<string>();
      const ensure = async (path: string) => {
        const parts = path.split("/");
        for (let i = 1; i <= parts.length; i++) {
          const d = parts.slice(0, i).join("/");
          if (made.has(d)) continue;
          if (!(await a.exists(d))) await a.mkdir(d);
          made.add(d);
        }
      };
      let n = 0;
      for (const p of plan) {
        tracker.update(task, { done: n++, total: plan.length, detail: p.to });
        const dest = `${dir}/${p.to}`;
        await ensure(dest.slice(0, dest.lastIndexOf("/")));
        await a.writeBinary(dest, (await zip.files[p.from].async("uint8array")).slice().buffer as ArrayBuffer);
      }
      tracker.finish(task, "done", `Booker ${rel.version} installed`);
      say(`Booker ${rel.version} is installed. Reload to use it.`);
      new ConfirmModal(this.plugin.app, "Reload Booker?", `Booker ${rel.version} is installed. Reload now to start using it. Your books and settings are as you left them.`, "Reload", () => void this.reload()).open();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tracker.finish(task, "failed", msg);
      say(`Could not update. ${msg}`);
      new Notice(`Booker: could not update. ${msg}`);
    } finally {
      this.busy = false;
    }
  }

  private async reload() {
    const plugins = (this.plugin.app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<void> } }).plugins;
    await plugins.disablePlugin("booker");
    await plugins.enablePlugin("booker");
  }

  get supportsInstall(): boolean {
    return Platform.isDesktopApp;
  }
}
