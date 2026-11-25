import { Notice, TFile } from "obsidian";
import type BookerPlugin from "../main";
import { findProjects } from "../project/vaultOps";
import type { BgTask } from "../tasks/tracker";
import { bodyOf, grounded, MIN_WORDS, oneLine, summaryDue, wordCount } from "./background";
import { Cancelled, summarizeLong } from "./mapreduce";
import { clampSentences, namesHint, pieceSummaryPrompt, tidy } from "./prompt";

const WAIT_MS = 15000;
const MIN_FORCED = 100;

interface Job {
  path: string;
  force: boolean;
  /** part of a bulk run: no notice per note */
  quiet?: boolean;
  task: BgTask;
  cancelled: boolean;
}

/** Summaries of scene notes written in the background after you move on from a note you have changed a good deal, or when asked. A short one (three sentences) and a longer one go into the note's properties. Needs the writing model; runs one note at a time on this computer, and shows in the task viewer. */
export class AutoSummary {
  private queue: Job[] = [];
  private busy = false;
  private timer: number | null = null;
  private dirty = new Set<string>();
  private writing = false;
  /** the note you last edited yourself */
  lastEdited: string | null = null;

  constructor(private plugin: BookerPlugin) {}

  /** A note was edited (not by this class). */
  touched(file: unknown) {
    if (this.writing || !(file instanceof TFile) || file.extension !== "md") return;
    this.dirty.add(file.path);
    this.lastEdited = file.path;
  }

  /** The note in front changed (or none is in front): every edited note that is not it has been moved on from. */
  moved(activePath: string | undefined) {
    for (const p of [...this.dirty]) {
      if (p === activePath) continue;
      this.dirty.delete(p);
      const f = this.plugin.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) this.left(f);
    }
  }

  /** Write the summaries of this note as soon as the queue allows, whether or not it has changed. */
  async now(file: TFile) {
    if (!(await this.plugin.gen.models()).length) return void new Notice("Booker: the writing model is not installed, so there is nothing to write summaries with.");
    if (this.enqueue(file, true, 0)) new Notice("Booker: writing the summaries. Progress is in the task viewer on the Today card.");
  }

  /** Queue many notes at once (the Write card's button). Returns how many were newly queued. */
  async many(files: TFile[], quiet = true): Promise<number> {
    if (!(await this.plugin.gen.models()).length) {
      new Notice("Booker: the writing model is not installed, so there is nothing to write summaries with.");
      return 0;
    }
    let n = 0;
    for (const f of files) if (this.enqueue(f, true, 0, quiet)) n++;
    return n;
  }

  /** You have moved on from this note. */
  left(file: TFile | null | undefined) {
    if (!file || !this.plugin.settings.autoSceneSummaries || file.extension !== "md") return;
    const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm?.type !== "scene") return;
    if (String(fm.summary ?? fm.synopsis ?? "").trim()) return; // you wrote your own
    if (!findProjects(this.plugin.app).some((p) => file.path.startsWith(p.layout.scenes + "/"))) return;
    void this.plugin.gen.models().then((m) => m.length && this.enqueue(file, false, WAIT_MS));
  }

  private enqueue(file: TFile, force: boolean, wait: number, quiet = false): boolean {
    const existing = this.queue.find((j) => j.path === file.path);
    if (existing) {
      existing.force = existing.force || force;
      return false;
    }
    const tracker = this.plugin.tasks;
    const job: Job = { path: file.path, force, quiet, cancelled: false, task: null as unknown as BgTask };
    job.task = tracker.add(`Summaries: ${file.basename}`, {
      cancel: () => {
        job.cancelled = true;
        if (this.queue.includes(job)) {
          this.queue = this.queue.filter((j) => j !== job);
          tracker.finish(job.task, "cancelled");
        }
      },
    });
    tracker.update(job.task, { detail: wait ? "Waiting a moment before starting" : "Waiting for its turn" });
    this.queue.push(job);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.drain(), wait);
    return true;
  }

  stop() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    for (const j of this.queue) this.plugin.tasks.finish(j.task, "cancelled");
    this.queue = [];
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    const tracker = this.plugin.tasks;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        const file = this.plugin.app.vault.getAbstractFileByPath(job.path);
        if (!(file instanceof TFile)) {
          tracker.finish(job.task, "failed", "The note is gone.");
          continue;
        }
        tracker.start(job.task);
        try {
          const outcome = await this.summarise(file, job);
          tracker.finish(job.task, outcome.startsWith("Skipped") || outcome.startsWith("The ") ? "skipped" : "done", outcome);
          if (job.force && !job.quiet) new Notice(outcome.startsWith("Skipped") ? `Booker: ${outcome}` : `Booker: summary for ${file.basename}: ${outcome}`, 12000);
        } catch (e) {
          if (e instanceof Cancelled) tracker.finish(job.task, "cancelled");
          else {
            console.error("Booker: scene summary failed", e);
            tracker.finish(job.task, "failed", e instanceof Error ? e.message : String(e));
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }

  /** Write the summaries; returns what happened, for the task viewer. */
  private async summarise(file: TFile, job: Job): Promise<string> {
    const app = this.plugin.app;
    const tracker = this.plugin.tasks;
    const info = (await this.plugin.gen.models())[0];
    if (!info) return "The writing model is not installed.";
    const body = bodyOf(await app.vault.read(file));
    const words = wordCount(body);
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const before = typeof fm?.summary_ai_words === "number" ? fm.summary_ai_words : undefined;
    const least = job.force ? MIN_FORCED : MIN_WORDS;
    if (words < least) return `Skipped: it has ${words} words, and a scene needs at least ${least}.`;
    if (!job.force && !summaryDue(words, before)) return "Skipped: not changed enough since the last summary.";
    tracker.update(job.task, { detail: "Loading the model" });
    const link = (v: unknown) => String(v ?? "").replace(/\[\[|\]\]/g, "").replace(/\|.*$/, "").trim();
    const people = [fm?.pov, ...(Array.isArray(fm?.characters) ? fm.characters : [])].map(link);
    // only characters the text itself names (the full name or its first word), so a character listed for the scene but absent from it is not invented into the summary
    const lower = body.toLowerCase();
    const hint = namesHint(people.filter((n) => n && (lower.includes(n.toLowerCase()) || lower.includes(n.toLowerCase().split(/\s+/)[0]))));
    const gen = await this.plugin.gen.generator(info);
    const cancelled = () => job.cancelled;
    const write = (prompt: string, max: number) => gen.write(prompt, max, cancelled);
    const long = await summarizeLong(body, {
      sentences: words < 300 ? 4 : 6,
      chunkWords: info.chunkWords,
      hint,
      write,
      cancelled,
      onProgress: (p) => tracker.update(job.task, { detail: p.step, done: p.done, total: p.total + 1 }),
    });
    if (!long) return "The model wrote nothing.";
    if (!grounded(long, body)) return "Skipped: the model's summary did not match the scene, so nothing was written. Try again after writing more of the scene.";
    tracker.update(job.task, { detail: "Writing the short summary" });
    const wrote = clampSentences(tidy(await write(pieceSummaryPrompt(long, 3, hint), 35 * 3 + 30)), 3);
    const short = grounded(wrote, body) ? wrote : clampSentences(long, 3);
    this.writing = true;
    try {
      await app.fileManager.processFrontMatter(file, (f) => {
        f.summary_ai = oneLine(long);
        f.summary_ai_short = oneLine(short || long);
        f.summary_ai_words = words;
      });
    } finally {
      window.setTimeout(() => (this.writing = false), 1500);
    }
    return short || long;
  }
}
