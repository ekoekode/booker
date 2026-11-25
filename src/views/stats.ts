import { ItemView, Menu, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type BookerPlugin from "../main";
import { analyse, combine, topFromFreq, type SceneProse } from "../project/prose";
import { clock, isDone, lengthLabel, msLeft, pace, SPRINT_LENGTHS, sprintTotals, sprintWords } from "../sprint";
import { currentStreak, dayKey, lastDays } from "../stats";
import { activityGrid, characterShare, clockHours, history, historyCsv, locationShare, overview, perAct, perChapter, povShare, type Bucket, type Share } from "../statsModel";
import { levelsFromSlots } from "../profiles/structure";
import { wordsFor, type Words } from "../profiles/words";
import { createWorldEntry, findProjects, getLabels, profileFor, Project, readScenes, worldEntries, worldKinds } from "../project/vaultOps";
import { actionBtn, actionRow, ListPicker, notifyError } from "../ui";
import { statusesFor } from "../profiles/profile";
import { statusCounts } from "../project/hubModel";

export const VIEW_STATS = "booker-stats";

const NS = "http://www.w3.org/2000/svg";
const fmt = (n: number) => n.toLocaleString();

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag);
  if (cls) e.addClass(...cls.split(" ").filter(Boolean));
  if (text !== undefined) e.setText(text);
  return e;
}

/** Open/closed state of the sections, kept while Obsidian runs. */
const openSections = new Map<string, boolean>();

export class StatsView extends ItemView {
  private projectPath = "";
  /** per scene: what was measured and when the file last changed */
  private static prose = new Map<string, { mtime: number; data: SceneProse }>();
  private sprintBox?: HTMLElement;
  private run = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_STATS;
  }
  getDisplayText() {
    return "Writing stats";
  }
  getIcon() {
    return "bar-chart-2";
  }

  getState() {
    return { project: this.projectPath };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    await super.setState(state, result);
    this.render();
  }

  async onOpen() {
    this.contentEl.addClass("booker-dash");
    this.registerEvent((this.plugin.events as any).on("stats", () => this.render()));
    this.registerEvent((this.plugin.events as any).on("sprint", () => this.paintSprint()));
    this.registerEvent(this.plugin.app.metadataCache.on("changed", () => this.refresh()));
    this.registerInterval(window.setInterval(() => this.sprintBox?.isConnected && this.paintSprint(), 1000));
    this.render();
  }

  private timer?: number;
  private refresh() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 600);
  }

  private project(): Project | null {
    const all = findProjects(this.plugin.app);
    return all.find((p) => p.file.path === this.projectPath) ?? all.find((p) => p.file.path === this.plugin.hubProject()) ?? all[0] ?? null;
  }

  /** A collapsible section; its state is remembered. */
  private section(root: HTMLElement, key: string, title: string, defaultOpen: boolean, onFirstOpen?: (body: HTMLElement) => void): HTMLElement {
    const d = el(root, "details", "booker-stats-sec");
    d.open = openSections.get(key) ?? defaultOpen;
    el(d, "summary", "booker-stats-sectitle", title);
    const body = el(d, "div", "booker-stats-secbody");
    let done = false;
    const go = () => {
      openSections.set(key, d.open);
      if (d.open && !done && onFirstOpen) {
        done = true;
        onFirstOpen(body);
      }
    };
    d.addEventListener("toggle", go);
    if (d.open && onFirstOpen) {
      done = true;
      onFirstOpen(body);
    }
    return body;
  }

  private render() {
    const root = this.contentEl;
    root.empty();
    this.run++;
    const proj = this.project();

    this.writing(root);
    if (!proj) return void el(root, "p", "booker-muted", "Create a project to see the book's numbers.");

    this.w = wordsFor(profileFor(proj));
    const scenes = readScenes(this.plugin.app, proj);
    const projects = findProjects(this.plugin.app);
    if (projects.length > 1) {
      const pick = el(root, "div", "booker-stats-pick");
      el(pick, "span", "booker-muted", "Book");
      const sel = el(pick, "select", "dropdown booker-stats-select");
      for (const p of projects) sel.createEl("option", { text: p.name, value: p.file.path }).selected = p === proj;
      sel.addEventListener("change", () => {
        this.projectPath = sel.value;
        void this.plugin.followHub(sel.value);
        this.render();
      });
    }
    this.book(root, proj, scenes);
    this.people(root, scenes);
    this.proseSection(root, scenes);
  }

  // ------------------------------------------------------------- writing

  private writing(root: HTMLElement) {
    const days = this.plugin.data.days;
    const goal = this.plugin.settings.dailyGoal;
    const today = days[dayKey()] ?? { net: 0, added: 0 };
    const body = this.section(root, "writing", "Writing", true);

    const tiles = el(body, "div", "booker-tiles");
    const tile = (label: string, value: string, sub?: string) => {
      const t = el(tiles, "div", "booker-tile");
      el(t, "div", "booker-tile-value", value);
      el(t, "div", "booker-tile-label", label);
      if (sub) el(t, "div", "booker-muted", sub);
    };
    tile("Today", fmt(today.added), goal ? `goal ${fmt(goal)}` : undefined);
    tile("Streak", `${currentStreak(days, Math.max(1, Math.min(goal || 1, 100)))}`, "days writing");
    tile("Last 7 days", fmt(lastDays(days, 7).reduce((n, x) => n + x.stats.added, 0)), "words added");

    this.sprintHistory(body);

    el(body, "h4", undefined, "Last 30 days");
    this.barChart(body, lastDays(days, 30), goal);

    el(body, "h4", undefined, "Last 12 weeks");
    this.heatmap(body, days);

    const h = history(days);
    const line = el(body, "div", "booker-stats-facts");
    el(line, "span", undefined, `${fmt(h.added)} written, ${fmt(h.deleted)} deleted, ${fmt(h.net)} net`);
    el(line, "span", undefined, `${fmt(h.activeDays)} days writing`);
    if (h.bestDay) el(line, "span", undefined, `best day ${fmt(h.bestDay.added)} (${h.bestDay.key})`);
    actionBtn(actionRow(body), "Export CSV", "download", () => void this.exportCsv(), { tip: "Save the day-by-day table as a CSV file in your export folder" });
  }

  private paintSprint() {
    const box = this.sprintBox;
    if (!box || !box.isConnected) return;
    const plugin = this.plugin;
    const sp = plugin.sprint;
    const running = !!sp && !sp.recorded && !isDone(sp);
    const sig = running ? `run` : sp?.recorded ? `done${sp.startedAt}` : "idle";
    if (running) {
      // keep the controls, only the numbers move each second
      let live: HTMLElement = box.querySelector<HTMLElement>(".booker-sprint-live") ?? box;
      if (live === box || box.dataset.sig !== sig) {
        box.empty();
        box.dataset.sig = sig;
        live = el(box, "div", "booker-sprint-live");
        el(live, "strong", "booker-sprint-clock");
        el(live, "span", "booker-muted booker-sprint-words");
        actionBtn(actionRow(live), "Stop", "square", () => plugin.endSprint(), { tip: "End the sprint now and keep it" });
      }
      live.querySelector(".booker-sprint-clock")!.textContent = clock(msLeft(sp!));
      live.querySelector(".booker-sprint-words")!.textContent = `${fmt(sprintWords(sp!, plugin.stats.sessionAdded))} words`;
      return;
    }
    if (box.dataset.sig === sig) return;
    box.empty();
    box.dataset.sig = sig;
    const row = el(box, "div", "booker-sprint-idle");
    if (sp?.recorded) el(row, "span", undefined, `Last sprint: ${fmt(sprintWords(sp, sp.endTotal ?? 0))} words, ${fmt(pace(sp, sp.endTotal ?? 0))} a minute`);
    const sel = el(row, "select", "dropdown");
    for (const m of SPRINT_LENGTHS) sel.createEl("option", { text: lengthLabel(m), value: String(m) });
    sel.value = String(SPRINT_LENGTHS[2]);
    actionBtn(actionRow(row), "Start sprint", "timer", () => plugin.beginSprint(Number(sel.value)), { cta: true, tip: "Count the words you write for this long" });
  }

  private sprintHistory(root: HTMLElement) {
    const list = this.plugin.data.sprints ?? [];
    if (!list.length) return void el(root, "p", "booker-muted", "Finished sprints are kept here: how many, how many words, how fast.");
    const t = sprintTotals(list);
    const grid = el(root, "div", "booker-stats-table");
    const head = ["", "Sprints", "Words", "Time", "Words/min"];
    head.forEach((h) => el(grid, "div", "booker-stats-th", h));
    for (const [label, x] of [["Today", t.today], ["7 days", t.week], ["30 days", t.month], ["All", t.all]] as const) {
      el(grid, "div", "booker-stats-td-label", label);
      [fmt(x.count), fmt(x.words), x.minutes ? clockHours(Math.round(x.minutes)) : "0 min", x.wpm ? String(x.wpm) : "-"].forEach((v) => el(grid, "div", "booker-stats-td", v));
    }
  }

  private async exportCsv() {
    const app = this.plugin.app;
    try {
      const folder = this.plugin.exportFolder();
      if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
      const path = `${folder}/Writing history ${dayKey()}.csv`;
      const text = historyCsv(this.plugin.data.days);
      const f = app.vault.getFileByPath(path);
      if (f) await app.vault.modify(f, text);
      else await app.vault.create(path, text);
      new Notice(`Saved ${path}`);
    } catch (e) {
      notifyError(e, "save the CSV");
    }
  }

  private heatmap(root: HTMLElement, days: Record<string, { added: number; net: number }>) {
    const cols = activityGrid(days, 12);
    const max = Math.max(1, ...cols.flat().map((c) => c?.added ?? 0));
    const goal = this.plugin.settings.dailyGoal;
    const grid = el(root, "div", "booker-heat");
    for (const col of cols) {
      const c = el(grid, "div", "booker-heat-col");
      for (const d of col) {
        const cell = el(c, "div", "booker-heat-cell");
        if (!d) {
          cell.addClass("is-empty");
          continue;
        }
        const level = d.added === 0 ? 0 : Math.min(4, 1 + Math.floor((d.added / max) * 3.999));
        cell.addClass(`level-${level}`);
        if (goal && d.added >= goal) cell.addClass("is-goal");
        cell.setAttr("title", `${d.key}: ${fmt(d.added)} words`);
      }
    }
  }

  // ------------------------------------------------------------- the book

  /** the book's own words for its levels, set at the start of each draw */
  private w: Words = wordsFor({ levels: levelsFromSlots(3, ["", "", ""]) });

  private book(root: HTMLElement, proj: Project, scenes: ReturnType<typeof readScenes>) {
    const body = this.section(root, "book", `${proj.name}: progress`, true);
    const o = overview(scenes);
    const tiles = el(body, "div", "booker-tiles");
    const tile = (label: string, value: string, sub?: string) => {
      const t = el(tiles, "div", "booker-tile");
      el(t, "div", "booker-tile-value", value);
      el(t, "div", "booker-tile-label", label);
      if (sub) el(t, "div", "booker-muted", sub);
    };
    tile("Words", fmt(o.words), `${fmt(o.scenes)} ${this.w.itemMany.toLowerCase()}`);
    tile("Read time", clockHours(o.readMinutes), "at 238 words a minute");
    tile(`Average ${this.w.item.toLowerCase()}`, fmt(o.avgScene), "words");
    if (!scenes.length) return void el(body, "p", "booker-muted", `Add ${this.w.itemMany.toLowerCase()} to see the breakdown.`);

    el(body, "h4", undefined, `${this.w.itemMany} by status`);
    const statuses = statusesFor(proj.profile);
    const counts = statusCounts(scenes, statuses);
    const bar = el(body, "div", "booker-statusbar");
    for (const s of statuses) if (counts[s]) el(bar, "span", `booker-seg status-${s}`).style.width = `${(counts[s] / scenes.length) * 100}%`;
    const legend = el(body, "div", "booker-hub-legend");
    for (const s of statuses) {
      const k = el(legend, "span");
      el(k, "span", `booker-dot status-${s}`);
      k.appendText(` ${s} ${counts[s] ?? 0}`);
    }

    const labels = getLabels(this.plugin.app, proj);
    if (this.w.hasTop) {
      el(body, "h4", undefined, `Words per ${this.w.top.toLowerCase()}`);
      this.bars(body, perAct(scenes, (a) => labels.acts[String(a)] || (String(a) === "0" ? "Prologue" : `${this.w.top} ${a}`)));
    }
    if (this.w.hasMid) {
      el(body, "h4", undefined, `Words per ${this.w.mid.toLowerCase()}`);
      this.bars(body, perChapter(scenes, (c) => labels.chapters[String(c)] ? `${c}. ${labels.chapters[String(c)]}` : `${this.w.mid} ${c}`));
    }
  }

  /** Every name and alias in the world notes, as lower-case words, so they are not offered again. */
  private knownNames(proj: Project): Set<string> {
    const app = this.plugin.app;
    const out = new Set<string>();
    const add = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}'’]+/u).filter(Boolean).forEach((w) => out.add(w.replace(/['’]s$/, "")));
    for (const k of worldKinds(app, proj)) {
      for (const f of worldEntries(app, proj, k)) {
        add(f.basename);
        const al = app.metadataCache.getFileCache(f)?.frontmatter?.aliases;
        for (const a of Array.isArray(al) ? al : typeof al === "string" ? [al] : []) add(String(a));
      }
    }
    return out;
  }

  /** What to do with a word you lean on. */
  private wordMenu(proj: Project, word: string, ev: MouseEvent, done: () => void) {
    const app = this.plugin.app;
    const name = word.charAt(0).toUpperCase() + word.slice(1);
    const menu = new Menu();
    for (const k of worldKinds(app, proj))
      menu.addItem((i) =>
        i.setTitle(`Create ${k.singular}: ${name}`).setIcon(k.icon || "plus").onClick(() =>
          void this.plugin
            .undoable(`New ${k.singular} “${name}”`, proj, [], () => createWorldEntry(app, proj, k, name))
            .then(done)
            .catch((e) => notifyError(e, "create the note"))
        )
      );
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle("Add as another name for…").setIcon("tag").onClick(() => {
        const entries = worldKinds(app, proj).flatMap((k) => worldEntries(app, proj, k).map((f) => ({ f, k })));
        new ListPicker(app, entries, (e) => `${e.f.basename} (${e.k.singular})`, `Another name for…`, (e) =>
          void this.plugin
            .undoable(`Added “${name}” as a name for ${e.f.basename}`, proj, [e.f.path], () =>
              app.fileManager.processFrontMatter(e.f, (fm) => {
                const cur = Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [String(fm.aliases)] : [];
                if (!cur.map((x: unknown) => String(x).toLowerCase()).includes(name.toLowerCase())) cur.push(name);
                fm.aliases = cur;
              })
            )
            .then(done)
            .catch((err) => notifyError(err, "add the name"))
        ).open();
      })
    );
    menu.addItem((i) =>
      i.setTitle("Hide this word").setIcon("eye-off").onClick(() => {
        const map = (this.plugin.data.ignoredWords ??= {});
        (map[proj.file.path] ??= []).push(word.toLowerCase());
        void this.plugin.persist();
        done();
      })
    );
    menu.showAtMouseEvent(ev);
  }

  private bars(root: HTMLElement, items: Bucket[]) {
    const max = Math.max(1, ...items.map((b) => b.words));
    const list = el(root, "div", "booker-stats-bars");
    for (const b of items) {
      const row = el(list, "div", "booker-stats-barrow");
      el(row, "span", "booker-stats-barlabel", b.label);
      const track = el(row, "span", "booker-stats-bartrack");
      el(track, "span", "booker-stats-barfill").style.width = `${(b.words / max) * 100}%`;
      el(row, "span", "booker-muted booker-stats-barnum", `${fmt(b.words)} · ${b.scenes} ${(b.scenes === 1 ? this.w.item : this.w.itemMany).toLowerCase()}`);
    }
  }

  // ------------------------------------------------------------- people and places

  private people(root: HTMLElement, scenes: ReturnType<typeof readScenes>) {
    const body = this.section(root, "people", "Characters, point of view and places", false);
    if (!scenes.length) return void el(body, "p", "booker-muted", `Add ${this.w.itemMany.toLowerCase()} first.`);
    const block = (title: string, items: Share[], unit: string) => {
      el(body, "h4", undefined, title);
      if (!items.length) return void el(body, "p", "booker-muted", `Nothing tagged on any ${this.w.item.toLowerCase()} yet.`);
      const max = Math.max(1, ...items.map((s) => s.scenes));
      const list = el(body, "div", "booker-stats-bars");
      for (const s of items.slice(0, 15)) {
        const row = el(list, "div", "booker-stats-barrow");
        el(row, "span", "booker-stats-barlabel", s.name);
        const track = el(row, "span", "booker-stats-bartrack");
        el(track, "span", "booker-stats-barfill").style.width = `${(s.scenes / max) * 100}%`;
        el(row, "span", "booker-muted booker-stats-barnum", `${s.scenes} ${unit}`);
      }
    };
    const unit = this.w.itemMany.toLowerCase();
    block("Point of view", povShare(scenes), unit);
    block("Characters", characterShare(scenes), unit);
    block("Places", locationShare(scenes), unit);
  }

  // ------------------------------------------------------------- prose

  private proseSection(root: HTMLElement, scenes: ReturnType<typeof readScenes>) {
    this.section(root, "prose", "Prose: dialogue, readability, favourite words, echoes", false, (body) => void this.runProse(body, scenes));
  }

  /** Measures every scene that changed since last time, a few at a time so typing stays smooth. */
  private async runProse(body: HTMLElement, scenes: ReturnType<typeof readScenes>) {
    const my = this.run;
    const app = this.plugin.app;
    const status = el(body, "p", "booker-muted", `Reading the ${this.w.itemMany.toLowerCase()}…`);
    const out: Array<{ title: string; path: string; data: SceneProse }> = [];
    let n = 0;
    for (const s of scenes) {
      if (my !== this.run || !body.isConnected) return;
      const f = app.vault.getAbstractFileByPath(s.path);
      if (!(f instanceof TFile)) continue;
      let cached = StatsView.prose.get(s.path);
      if (!cached || cached.mtime !== f.stat.mtime) {
        cached = { mtime: f.stat.mtime, data: analyse(await app.vault.cachedRead(f)) };
        StatsView.prose.set(s.path, cached);
        if (++n % 4 === 0) {
          status.setText(`Reading the ${this.w.itemMany.toLowerCase()}… ${out.length} of ${scenes.length}`);
          await new Promise((r) => window.setTimeout(r, 0));
        }
      }
      out.push({ title: s.title, path: s.path, data: cached.data });
    }
    status.remove();
    if (!out.length) return void el(body, "p", "booker-muted", `No ${this.w.item.toLowerCase()} text to measure.`);

    const all = combine(out.map((x) => x.data));
    const tiles = el(body, "div", "booker-tiles");
    const tile = (label: string, value: string, sub?: string) => {
      const t = el(tiles, "div", "booker-tile");
      el(t, "div", "booker-tile-value", value);
      el(t, "div", "booker-tile-label", label);
      if (sub) el(t, "div", "booker-muted", sub);
    };
    tile("Dialogue", `${all.dialoguePct}%`, `${fmt(all.dialogue)} of ${fmt(all.dialogue + all.narrative)} words`);
    tile("Reading ease", String(all.ease), "higher is easier");
    tile("Grade level", String(all.grade), "Flesch-Kincaid");
    tile("Sentence", String(all.avgSentence), "words on average");
    tile("Word", String(all.avgWord), "letters on average");

    const split = el(body, "div", "booker-statusbar");
    el(split, "span", "booker-seg booker-seg-dialogue").style.width = `${all.dialoguePct}%`;
    el(split, "span", "booker-seg booker-seg-narrative").style.width = `${100 - all.dialoguePct}%`;

    el(body, "h4", undefined, "Words you lean on");
    const proj = this.project();
    const known = proj ? this.knownNames(proj) : new Set<string>();
    const ignored = new Set((proj && this.plugin.data.ignoredWords?.[proj.file.path]) || []);
    const top = topFromFreq(out.map((x) => x.data), 200).filter((t) => !known.has(t.word.toLowerCase()) && !ignored.has(t.word.toLowerCase())).slice(0, 15);
    el(body, "p", "booker-muted", "Press a word to turn it into a character, place or other note, add it as another name for one, or hide it. Names you already have are left out.");
    const max = Math.max(1, ...top.map((t) => t.count));
    const list = el(body, "div", "booker-stats-bars");
    for (const t of top) {
      const row = el(list, "div", "booker-stats-barrow");
      const lab = el(row, "span", "booker-stats-barlabel is-link", t.word);
      lab.addEventListener("click", (ev) => {
        if (proj) this.wordMenu(proj, t.word, ev, () => row.remove());
      });
      const track = el(row, "span", "booker-stats-bartrack");
      el(track, "span", "booker-stats-barfill").style.width = `${(t.count / max) * 100}%`;
      el(row, "span", "booker-muted booker-stats-barnum", `${t.count}×`);
    }

    el(body, "h4", undefined, "Echoes: words that come back too soon");
    const echoes = out.flatMap((x) => x.data.echoes.map((e) => ({ ...e, title: x.title, path: x.path }))).sort((a, b) => b.count - a.count).slice(0, 15);
    if (!echoes.length) return void el(body, "p", "booker-muted", "Nothing repeats within 40 words.");
    for (const e of echoes) {
      const row = el(body, "div", "booker-stats-echo");
      el(row, "strong", undefined, e.phrase);
      el(row, "span", "booker-muted", ` ×${e.count + 1} in `);
      const a = el(row, "a", undefined, e.title);
      a.addEventListener("click", () => void this.plugin.app.workspace.getLeaf("tab").openFile(this.plugin.app.vault.getFileByPath(e.path)!));
    }
  }

  // ------------------------------------------------------------- chart

  private barChart(root: HTMLElement, data: { key: string; stats: { added: number } }[], goal: number) {
    const W = Math.max(260, Math.floor(this.contentEl.clientWidth - 56)) || 640;
    const H = 150;
    const pad = { l: 36, r: 8, t: 8, b: 20 };
    const max = Math.max(goal, ...data.map((x) => x.stats.added), 100);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "booker-chart");
    const bw = (W - pad.l - pad.r) / data.length;
    const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text) e.textContent = text;
      svg.appendChild(e);
      return e;
    };
    add("line", { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: "booker-axis" });
    add("text", { x: pad.l - 4, y: y(0) + 3, "text-anchor": "end", class: "booker-axis-text" }, "0");
    add("text", { x: pad.l - 4, y: y(max) + 8, "text-anchor": "end", class: "booker-axis-text" }, String(max));
    data.forEach((x, i) => {
      const h = y(0) - y(x.stats.added);
      const r = add("rect", {
        x: pad.l + i * bw + 1,
        y: y(x.stats.added),
        width: Math.max(1, bw - 2),
        height: Math.max(h, x.stats.added > 0 ? 1 : 0),
        class: "booker-bar" + (goal && x.stats.added >= goal ? " is-goal" : ""),
      });
      const t = document.createElementNS(NS, "title");
      t.textContent = `${x.key}: ${x.stats.added.toLocaleString()} words`;
      r.appendChild(t);
      if (i % Math.max(1, Math.round(60 / bw)) === 0) add("text", { x: pad.l + i * bw + bw / 2, y: H - 6, "text-anchor": "middle", class: "booker-axis-text" }, x.key.slice(5));
    });
    if (goal) add("line", { x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal), class: "booker-goal-line" });
    root.appendChild(svg);
  }
}
