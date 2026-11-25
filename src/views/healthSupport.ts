import { MarkdownView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type BookerPlugin from "../main";
import { findingId, scanHealth, type Finding, type HealthContext, type HealthDoc, type HealthReport } from "../project/health";
import { removeFromProperties, type Known } from "../project/detect";
import { adoptStrayNotes, codexFiles, createCodex, findProjects, emptyStructure, findStrayNotes, pruneEmptyStructure, readMatter, readScenes, renumberScenes, sequenceReport, syncActFolders, syncStructure, getModel, type Project } from "../project/vaultOps";
import { statusesFor } from "../profiles/profile";
import { openNoteIn } from "../openTarget";
import type { Passage } from "../scripture/ref";
import { positionsOf } from "../project/mapPins";
import { setPosition } from "../project/mapsStore";
import { WORLD_ID } from "../project/mapsConfig";

/** The Bible module used to check references, or undefined when none can be read. */
export async function existsCheck(plugin: BookerPlugin): Promise<((p: Passage) => boolean) | undefined> {
  try {
    const files = await plugin.modules.bibles();
    if (!files.length) return undefined;
    const data = plugin.scriptureData();
    const mod = await plugin.modules.load(files.find((f) => f.path === data.defaultModule) ?? files[0]);
    return (p) => {
      if (!mod.books().includes(p.book)) return true; // a book the module does not carry cannot be judged
      const at = (x: Passage["from"]) => (x.v === null ? mod.chapterCount(p.book) >= x.c : mod.verse(p.book, x.c, x.v) !== null);
      return at(p.from) && at(p.to);
    };
  } catch {
    return undefined;
  }
}

const knownOf = (plugin: BookerPlugin, proj: Project, kind: "characters" | "locations"): Known[] =>
  codexFiles(plugin.app, proj, kind).map((f) => {
    const fm = plugin.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : typeof fm.aliases === "string" ? [fm.aliases] : [];
    return { name: String(fm.name ?? f.basename), aliases: aliases.map(String) };
  });

/** The text of every scene and piece of matter in a project, with what each scene's properties say. */
export async function healthDocs(plugin: BookerPlugin, proj: Project): Promise<HealthDoc[]> {
  const { app } = plugin;
  const out: HealthDoc[] = [];
  const add = async (path: string, title: string, scene?: HealthDoc["scene"]) => {
    const f = app.vault.getFileByPath(path);
    if (f) out.push({ path, title, text: await app.vault.cachedRead(f), scene });
  };
  for (const s of readScenes(app, proj)) await add(s.path, s.title, { status: s.status, pov: s.pov, characters: s.characters ?? [], location: s.location ?? [], setup: s.setup ?? [], payoff: s.payoff ?? [] });
  for (const m of readMatter(app, proj).filter((x) => x.enabled)) await add(m.path, m.title);
  return out;
}

/** What the scene checks compare against: this project's codex, scene names and the statuses that mean unwritten. */
export function healthContext(plugin: BookerPlugin, proj: Project): HealthContext {
  const scenes = readScenes(plugin.app, proj);
  return {
    characters: knownOf(plugin, proj, "characters"),
    locations: knownOf(plugin, proj, "locations"),
    sceneNames: scenes.flatMap((s) => [s.title, s.path.replace(/^.*\//, "").replace(/\.md$/, "")]),
    unfinished: statusesFor(proj.profile).slice(0, 2).map((x) => x.toLowerCase()),
  };
}

/** Files and structure the book's lists do not show: notes in the Scenes folder that are not marked as scenes, and empty chapters or acts left in a book from before they were recorded. */
export function fileFindings(plugin: BookerPlugin, proj: Project): Finding[] {
  const { app } = plugin;
  const out: Finding[] = [];
  for (const f of findStrayNotes(app, proj)) out.push({ group: "Files", message: "This note is in the book's folders but is not marked as a scene, so it is missing from the lists and the board.", path: f.path, line: 1, title: f.basename, fix: { kind: "adopt", label: "Add to book" } });
  if ((proj.formatVersion ?? 1) < 2) {
    const e = emptyStructure(app, proj, readScenes(app, proj));
    const n = e.chapters.length + e.acts.length;
    if (n) out.push({ group: "Files", message: `${n} empty chapter${n === 1 ? "" : "s"} or act${n === 1 ? "" : "s"} are remembered with no files behind them.`, path: "", line: 1, title: proj.name, fix: { kind: "prune", label: "Remove" } });
  }
  return out;
}

/** Scan one or several projects (a whole series is one manuscript) and report together. Warnings the author dismissed are returned apart. */
export async function scanProjects(plugin: BookerPlugin, projects: Project[]): Promise<{ report: HealthReport; checkedAgainstBible: boolean; dismissed: Finding[] }> {
  // notes deleted or changed in another editor are noticed: what your notes quote is read again, and the Reader redrawn
  plugin.quoted.refresh();
  plugin.refreshQuoted();
  const exists = await existsCheck(plugin);
  const sources = plugin.sources().map((s) => ({ citekey: s.citekey, title: s.title, library: s.kind === "db" }));
  const reports = await Promise.all(
    projects.map(async (p) => {
      const r = scanHealth(await healthDocs(plugin, p), sources, exists, healthContext(plugin, p));
      const skip = new Set(plugin.dismissedHealth(p));
      const seq: Finding[] = (await sequenceReport(plugin.app, p).catch(() => null))?.findings.map((f) => ({ group: "Sequences" as const, message: f.message, path: f.path, line: 1, title: f.path.split("/").pop()?.replace(/\.md$/, "") ?? f.path })) ?? [];
      const all = [...fileFindings(plugin, p), ...r.findings, ...seq].map((f) => ({ ...f, project: p.file.path }));
      return { counts: r.counts, findings: all.filter((f) => !skip.has(findingId(f))), dismissed: all.filter((f) => skip.has(findingId(f))) };
    })
  );
  const first = reports[0] ?? { findings: [], dismissed: [], counts: { verses: 0, citations: 0, notes: 0, sources: 0 } };
  const report: HealthReport = { findings: reports.flatMap((r) => r.findings), counts: { ...first.counts } };
  for (const r of reports.slice(1)) for (const k of ["verses", "citations", "notes"] as const) report.counts[k] += r.counts[k];
  return { report, checkedAgainstBible: !!exists, dismissed: reports.flatMap((r) => r.dismissed) };
}

/** Dismiss a warning (or bring it back). It stays dismissed while the same problem is there. */
export async function setDismissed(plugin: BookerPlugin, f: Finding, dismissed: boolean) {
  const proj = findProjects(plugin.app).find((p) => p.file.path === f.project);
  if (proj) await plugin.setHealthDismissed(proj, findingId(f), dismissed);
}

/**
 * Rebuild everything Booker keeps about a book from its files: word counts, the quoted-text index, the remembered structure and act folders, scene numbering and the characters and places listed on each scene.
 * The semantic search index is large, so it is rebuilt from Manage indexes instead. Returns a one-line report.
 */
export async function rebuildProject(plugin: BookerPlugin, proj: Project): Promise<string> {
  const { app } = plugin;
  await plugin.stats.reconcile();
  plugin.quoted.refresh();
  plugin.refreshQuoted();
  const scenes = readScenes(app, proj);
  const changed = await syncStructure(app, proj, scenes).catch(() => false);
  await syncActFolders(app, proj, getModel(app, proj, readScenes(app, proj)).acts).catch(() => undefined);
  const renumbered = proj.numberScenes ? await renumberScenes(app, proj) : 0;
  const detected = proj.detectNames === false ? 0 : await plugin.detector.detectProject(proj);
  return `Rebuilt ${scenes.length} scene${scenes.length === 1 ? "" : "s"}: word counts and quoted text refreshed${changed ? ", structure corrected" : ""}${renumbered ? `, ${renumbered} title${renumbered === 1 ? "" : "s"} renumbered` : ""}${detected ? `, names added to ${detected} scene${detected === 1 ? "" : "s"}` : ""}.`;
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Make the Codex note a scene names but the book does not have. A place also gets its position from the scene that names it (the one the
 * warning is about first, then any other scene that names the same place): on the real world and on every drawn map that scene is on.
 * Returns false when the note already exists.
 */
export async function createMissingNote(plugin: BookerPlugin, proj: Project, fix: { entry: "characters" | "locations"; name: string }, scenePath: string): Promise<boolean> {
  const { app } = plugin;
  if (knownOf(plugin, proj, fix.entry).some((k) => sameName(k.name, fix.name) || (k.aliases ?? []).some((a) => sameName(a, fix.name)))) return false;
  let file;
  try {
    file = await createCodex(app, proj, fix.entry === "characters" ? "character" : "location", fix.name);
  } catch {
    return false;
  }
  if (fix.entry === "locations") {
    const scenes = readScenes(app, proj);
    const naming = [...scenes.filter((s) => s.path === scenePath), ...scenes.filter((s) => s.path !== scenePath)].filter((s) => (s.location ?? []).some((l) => sameName(l, fix.name)));
    for (const s of naming) {
      const fm = app.metadataCache.getCache(s.path)?.frontmatter;
      const spots = positionsOf(fm);
      if (!spots.length) continue;
      for (const p of spots) await setPosition(app, file, p.mapId, { x: p.x, y: p.y }, p.mapId === WORLD_ID ? { address: String(fm?.address ?? ""), label: String(fm?.geoPlace ?? ""), decimals: 5 } : { decimals: 6 });
      break;
    }
  }
  return true;
}

/** Take the name off the scene's properties, or make the missing Codex note. The scene's text is never touched. */
export async function applyFix(plugin: BookerPlugin, f: Finding): Promise<boolean> {
  const fix = f.fix;
  if (!fix) return false;
  const proj = findProjects(plugin.app).find((p) => p.file.path === f.project);
  if (fix.kind === "create") return !!proj && (await createMissingNote(plugin, proj, fix, f.path));
  if (fix.kind === "prune") return !!proj && (await pruneEmptyStructure(plugin.app, proj, readScenes(plugin.app, proj))) > 0;
  const file = plugin.app.vault.getFileByPath(f.path);
  if (!file) return false;
  if (fix.kind === "adopt") return !!proj && (await adoptStrayNotes(plugin.app, proj, [file])) > 0;
  let changed = false;
  await plugin.app.fileManager.processFrontMatter(file, (fm) => {
    changed = removeFromProperties(fm, fix.kind === "characters" ? { characters: [fix.name] } : { locations: [fix.name] });
  });
  return changed;
}

/** Fix every finding that has a fix; returns how many were changed. A name several scenes share is made once. */
export async function applyFixes(plugin: BookerPlugin, findings: Finding[]): Promise<number> {
  let n = 0;
  const made = new Set<string>();
  for (const f of findings) {
    if (!f.fix) continue;
    if (f.fix.kind === "create") {
      const key = `${f.project ?? ""}|${f.fix.entry}|${f.fix.name.trim().toLocaleLowerCase()}`;
      if (made.has(key)) continue;
      made.add(key);
    }
    if (await applyFix(plugin, f)) n++;
  }
  return n;
}

/** Approve findings: creating notes is one undoable step per book; other fixes run as they always have. */
export async function approveFixes(plugin: BookerPlugin, findings: Finding[]): Promise<number> {
  const creating = findings.filter((f) => f.fix?.kind === "create");
  const other = findings.filter((f) => f.fix && f.fix.kind !== "create");
  let n = other.length ? await applyFixes(plugin, other) : 0;
  const byProject = new Map<string, Finding[]>();
  for (const f of creating) byProject.set(f.project ?? "", [...(byProject.get(f.project ?? "") ?? []), f]);
  for (const [path, list] of byProject) {
    const proj = findProjects(plugin.app).find((p) => p.file.path === path) ?? null;
    n += proj ? await plugin.undoable(list.length > 1 ? "Create Codex notes" : "Create Codex note", proj, [], () => applyFixes(plugin, list)) : await applyFixes(plugin, list);
  }
  return n;
}

/** Open the note a finding points at and put the cursor on its line; a finding about a source opens the source. */
export async function openFinding(plugin: BookerPlugin, f: Finding, leaf?: WorkspaceLeaf) {
  if (!f.path) {
    const s = f.key ? plugin.sources().find((x) => x.citekey === f.key) : undefined;
    if (s) void plugin.openSource(s);
    return;
  }
  const file = plugin.app.vault.getFileByPath(f.path);
  if (!file) return;
  await openNoteIn(plugin, file, leaf);
  window.setTimeout(() => {
    const mv = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (mv?.file?.path === f.path) {
      mv.editor.setCursor({ line: Math.max(0, f.line - 1), ch: 0 });
      mv.editor.scrollIntoView({ from: { line: Math.max(0, f.line - 1), ch: 0 }, to: { line: f.line, ch: 0 } }, true);
    }
  }, 250);
}

/** One group of warnings: a heading (with "Remove all" when the group has fixes) and a row for each, clicking a row opens it. */
export function drawGroup(plugin: BookerPlugin, parent: HTMLElement, group: string, list: Finding[], open: (f: Finding) => void, rescan: () => void, dismissed = false) {
  const head = parent.createEl("h4", { text: `${group} (${list.length})` });
  const fixable = list.filter((f) => f.fix);
  if (fixable.length > 1) {
    const creating = fixable.every((f) => f.fix?.kind === "create");
    const all = head.createEl("button", { cls: "booker-health-fix" + (creating ? " mod-cta" : ""), text: `${creating ? "Approve all" : fixable[0].fix?.kind === "adopt" ? "Add all" : "Remove all"} ${fixable.length}` });
    all.title = creating ? "Create every one of these Codex notes. A place gets its coordinates from the scene that names it. You can undo it." : "Take these names off the scenes' file info. The scene text is not changed.";
    all.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void approveFixes(plugin, fixable).then((n) => {
        new Notice(creating ? `Booker: created ${n} Codex note${n === 1 ? "" : "s"}.` : `Booker: updated the file info of ${n} scene${n === 1 ? "" : "s"}.`);
        rescan();
      });
    });
  }
  for (const f of list) {
    const row = parent.createDiv({ cls: "booker-hub-scene" });
    row.createSpan({ cls: "booker-hub-scene-title", text: f.message });
    row.createSpan({ cls: "booker-muted", text: f.path ? `${f.title}${f.line > 1 ? `, line ${f.line}` : ""}` : "" });
    if (f.fix) {
      const create = f.fix.kind === "create";
      const b = row.createEl("button", { cls: "booker-health-fix" + (create ? " mod-cta" : ""), text: create ? "Approve" : f.fix.kind === "adopt" || f.fix.kind === "prune" ? f.fix.label : "Remove" });
      b.title = create ? `Create the Codex note “${(f.fix as { name: string }).name}”${(f.fix as { entry: string }).entry === "locations" ? ", with the coordinates from this scene" : ""}. You can undo it.` : f.fix.kind === "adopt" ? "Mark this note as a scene so it shows in the book" : f.fix.kind === "prune" ? "Forget these empty chapters and acts" : `Take “${(f.fix as { name: string }).name}” off this scene's file info`;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void approveFixes(plugin, [f]).then(rescan);
      });
    }
    const hide = row.createEl("button", { cls: "clickable-icon booker-health-dismiss" });
    setIcon(hide, "x");
    hide.setAttr("aria-label", dismissed ? "Show this warning again" : "Dismiss this warning");
    hide.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void setDismissed(plugin, f, !dismissed).then(rescan);
    });
    row.addEventListener("click", () => open(f));
  }
}

/** Check one project now and say so: the pop-up the hub's and the project settings' health buttons show. */
export async function verifyHealth(plugin: BookerPlugin, project: Project, button?: HTMLElement) {
  button?.addClass("is-busy");
  try {
    const { report } = await scanProjects(plugin, [project]);
    const n = report.findings.length;
    new Notice(n ? `Booker: project health checked. ${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention. Open Project health from the hub to see ${n === 1 ? "it" : "them"}.` : "Booker: project health has been verified. Nothing needs fixing.", 8000);
  } catch (e) {
    new Notice(`Booker: could not check the project. ${e instanceof Error ? e.message : e}`);
  } finally {
    button?.removeClass("is-busy");
  }
}
