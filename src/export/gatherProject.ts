import type BookerPlugin from "../main";
import { compareScenes } from "../project/format";
import { readMatter } from "../project/vaultOps";
import { findProjects, getLabels, getModel, profileFor, Project, readScenes, seriesBooks } from "../project/vaultOps";
import { wordsFor } from "../profiles/words";
import { splitFrontmatter } from "../text";
import { uuid, Gathered } from "./gather";
import type { ExportOptions, SceneDateOptions } from "./headings";
import { sortGlossary } from "./glossary";
import { buildIndex, indexTerms } from "./bookIndex";
import { buildScriptureIndex, scanReferences } from "../scripture/index";
import { makeCiter } from "../citations/cite";
import { allProfiles, profileById, statusesFor } from "../profiles/profile";
import { ActDoc, Block, ChapterDoc, cleanManuscript, countManuscriptWords, Manuscript, parseMarkdown, SceneDoc } from "./model";

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** The projects an export can start from. */
export function exportableProjects(plugin: BookerPlugin): Project[] {
  return findProjects(plugin.app);
}

/** Build a manuscript from a project: acts, chapters and scenes in reading order, with their names. */
export async function gatherProject(plugin: BookerPlugin, proj: Project, opts: ExportOptions): Promise<Gathered> {
  const { app, settings } = plugin;
  const fm = (app.metadataCache.getFileCache(proj.file)?.frontmatter ?? {}) as Record<string, any>;
  const scenes = readScenes(app, proj).sort(compareScenes);
  const labels = getLabels(app, proj);
  const model = getModel(app, proj, scenes);
  const statuses = statusesFor(proj.profile);
  const minIdx = Math.max(0, statuses.indexOf(opts.minSceneStatus ?? statuses[0]));
  let skipped = 0;
  let included = 0;

  const bySource = new Map(plugin.sources().map((x) => [x.citekey, x]));
  const citer = makeCiter((k) => bySource.get(k), opts.citationStyle ?? (["chicago", "sbl", "apa", "mla"].includes(fm.citationStyle) ? fm.citationStyle : undefined) ?? profileById(allProfiles(), proj.profile).citationStyle, { ibid: opts.ibid });
  const terms = indexTerms(fm.indexTerms);
  const acts: ActDoc[] = [];
  const matterAct = async (position: "front" | "back"): Promise<ActDoc | null> => {
    const chapters: ChapterDoc[] = [];
    for (const n of readMatter(app, proj).filter((x) => x.position === position && x.enabled)) {
      if (terms.length && opts.bookIndex !== false && n.title.trim().toLowerCase() === "index") continue;
      const file = app.vault.getFileByPath(n.path);
      if (!file) continue;
      const body = splitFrontmatter(await app.vault.cachedRead(file)).body;
      const blocks = parseMarkdown(n.title.trim().toLowerCase() === "glossary" ? sortGlossary(body) ?? body : body, { lineBreaksAreParagraphs: opts.lineBreaksAreParagraphs, smartQuotes: opts.smartQuotes, cite: (k, l) => citer.note(k, l), citeInline: citer.inline });
      if (blocks.length) chapters.push({ title: n.title, number: 0, back: true, scenes: [{ title: n.title, blocks }] });
    }
    return chapters.length ? { title: position === "front" ? "Front matter" : "Back matter", titled: false, number: 0, chapters } : null;
  };
  const w = wordsFor(profileFor(proj));
  // a book with no middle level prints its items as the chapters; the hidden middle level never shows
  const flat = !w.hasMid;
  const midWord = w.hasMid ? (w.mid.toLowerCase() === "chapter" ? undefined : w.mid) : w.item.toLowerCase() === "chapter" ? undefined : w.item;
  const topWord = w.top.toLowerCase() === "act" ? undefined : w.top;
  const frontAct = await matterAct("front");
  if (frontAct) acts.push(frontAct);
  let chapterNo = 0;
  let actNo = 0;
  const actsWithText = model.acts.filter((a) => scenes.some((s) => Number(s.act) === a));
  for (const a of model.acts) {
    const chapters: ChapterDoc[] = [];
    for (const c of model.chapters.filter((x) => x.act === a)) {
      const docs: SceneDoc[] = [];
      for (const sc of scenes.filter((s) => Number(s.act) === a && Number(s.chapter) === c.num)) {
        const idx = statuses.indexOf(sc.status);
        if (idx >= 0 && idx < minIdx) {
          skipped++;
          continue;
        }
        const file = app.vault.getFileByPath(sc.path);
        if (!file) continue;
        const blocks = parseMarkdown(splitFrontmatter(await app.vault.cachedRead(file)).body, {
          lineBreaksAreParagraphs: opts.lineBreaksAreParagraphs,
          smartQuotes: opts.smartQuotes,
          cite: (k, l) => citer.note(k, l),
          citeInline: citer.inline,
        });
        if (!blocks.length) continue;
        included++;
        const lead: Block[] = [];
        if (opts.sceneTitles && !flat) lead.push({ kind: "h", level: 3, runs: [{ text: sc.title }] });
        const date = sceneDateBlock(opts.sceneDates, sc.storyDate, sc.storyTime);
        if (date) lead.push(date);
        docs.push({ title: sc.title, blocks: [...lead, ...blocks] });
      }
      if (!docs.length) continue;
      if (flat) {
        for (const d of docs) {
          chapterNo++;
          chapters.push({ title: d.title, word: midWord, number: chapterNo, scenes: [d] });
        }
        continue;
      }
      chapterNo++;
      chapters.push({ title: labels.chapters[String(c.num)] || `${midWord ?? "Chapter"} ${chapterNo}`, word: midWord, number: chapterNo, scenes: docs });
    }
    if (!chapters.length) continue;
    // a single unnamed act is just the book; named acts and prologues get their own title page
    const name = labels.acts[String(a)] || (a === 0 ? "Prologue" : "");
    const titled = w.hasTop && (!!name || actsWithText.length > 1);
    if (titled && a !== 0) actNo++;
    acts.push({ title: name || `${w.top} ${a}`, titled, word: topWord, number: a === 0 ? 0 : actNo, chapters });
  }

  const backAct = await matterAct("back");
  if (backAct) acts.push(backAct);
  if (opts.bibliography !== false && citer.cited().length) {
    const entries = parseMarkdown(citer.bibliography().join("\n\n"), { lineBreaksAreParagraphs: false, smartQuotes: false });
    const heading = citer.bibliographyTitle;
    acts.push({ title: heading, titled: false, number: 0, chapters: [{ title: heading, number: 0, back: true, scenes: [{ title: heading, blocks: entries }] }] });
  }
  const wantIndex = opts.scriptureIndex ?? profileById(allProfiles(), proj.profile).backMatter.includes("scripture index");
  if (wantIndex) {
    const blockText = (b: Block) => ("runs" in b ? b.runs.map((r) => r.text + (r.note ? r.note.map((n) => n.text).join("") : "")).join("") : "");
    const found: { passage: ReturnType<typeof scanReferences>[number]; where: string }[] = [];
    for (const a of acts) for (const c of a.chapters) if (!c.back) for (const sc of c.scenes) for (const b of sc.blocks) for (const passage of scanReferences(blockText(b))) found.push({ passage, where: c.number ? `${c.word ?? "Chapter"} ${c.number}` : c.title });
    const groups = buildScriptureIndex(found);
    if (groups.length) {
      const blocks: Block[] = [];
      for (const g of groups) {
        blocks.push({ kind: "h", level: 3, runs: [{ text: g.book }] });
        for (const e of g.entries) blocks.push({ kind: "p", runs: [{ text: `${e.label}  ` }, { text: e.where.join(", "), i: true }] });
      }
      acts.push({ title: "Scripture Index", titled: false, number: 0, chapters: [{ title: "Scripture Index", number: 0, back: true, scenes: [{ title: "Scripture Index", blocks }] }] });
    }
  }
  if (terms.length && opts.bookIndex !== false) {
    const blockText = (b: Block) => ("runs" in b ? b.runs.map((r) => r.text).join("") : "");
    const src: { where: string; text: string }[] = [];
    for (const a of acts) for (const c of a.chapters) if (!c.back) for (const sc of c.scenes) src.push({ where: c.number ? `${c.word ?? "Chapter"} ${c.number}` : c.title, text: sc.blocks.map(blockText).join("\n") });
    const entries = buildIndex(terms, src);
    if (entries.length) {
      const blocks: Block[] = entries.map((e) => ({ kind: "p", runs: [{ text: `${e.term}  ` }, { text: e.where.join(", "), i: true }] }));
      acts.push({ title: "Index", titled: false, number: 0, chapters: [{ title: "Index", number: 0, back: true, scenes: [{ title: "Index", blocks }] }] });
    }
  }
  const author = str(fm.author) || settings.authorName;
  const surname = settings.authorSurname || (author ? author.split(/\s+/).slice(-1)[0] : "");
  const m: Manuscript = cleanManuscript({
    title: str(fm.title) || proj.name,
    subtitle: str(fm.subtitle),
    author,
    surname,
    contact: settings.authorContact,
    language: str(fm.language) || "en",
    words: 0,
    dedication: str(fm.dedication),
    copyright: str(fm.copyright) || (author ? `Copyright © ${new Date().getFullYear()} ${author}` : ""),
    about: str(fm.about),
    coverPath: null,
    identifier: str(fm.isbn) || `urn:uuid:${uuid(str(fm.bookId) || proj.file.path)}`,
    acts,
  });
  m.words = countManuscriptWords(m);

  let cover: Gathered["cover"] = null;
  const folder = proj.file.parent?.path ?? "";
  for (const n of ["cover.jpg", "cover.jpeg", "cover.png"]) {
    const f = app.vault.getFileByPath(`${folder}/${n}`);
    if (f) {
      cover = { data: await app.vault.readBinary(f), ext: f.extension.toLowerCase().replace("jpeg", "jpg") };
      m.coverPath = f.path;
      break;
    }
  }
  return { manuscript: m, cover, skippedScenes: skipped, includedScenes: included, unknownCitations: citer.unknown() };
}

/**
 * Every book of the series as one manuscript (a box set): each book becomes a part named after it, with its chapters
 * numbered on through the series. Books with no exportable scenes are left out.
 */
export async function gatherSeries(plugin: BookerPlugin, proj: Project, opts: ExportOptions): Promise<Gathered> {
  const books = proj.series ? await seriesBooks(plugin.app, proj) : [proj];
  const acts: ActDoc[] = [];
  let first: Gathered | null = null;
  let skipped = 0;
  let included = 0;
  let chapterNo = 0;
  for (const b of books) {
    const g = await gatherProject(plugin, b, opts);
    skipped += g.skippedScenes;
    if (!g.includedScenes) continue;
    first ??= g;
    included += g.includedScenes;
    const chapters = g.manuscript.acts.flatMap((a) => a.chapters).map((c) => ({ ...c, number: ++chapterNo }));
    acts.push({ title: g.manuscript.title, titled: true, number: acts.length + 1, chapters });
  }
  if (!first) return { manuscript: { ...(await gatherProject(plugin, proj, opts)).manuscript, acts: [] }, cover: null, skippedScenes: skipped, includedScenes: 0 };
  const m: Manuscript = cleanManuscript({
    ...first.manuscript,
    title: proj.series?.name ?? first.manuscript.title,
    subtitle: "",
    dedication: "",
    about: "",
    identifier: `urn:uuid:${uuid(proj.series?.folder ?? proj.file.path)}`,
    acts,
  });
  m.words = countManuscriptWords(m);
  return { manuscript: m, cover: first.cover, skippedScenes: skipped, includedScenes: included };
}

/** The date line printed above a section, or nothing when the option is off or the section has no date. */
export function sceneDateBlock(o: SceneDateOptions | undefined, date: string | undefined, time: string | undefined): Block | null {
  if (!o?.on || !date?.trim()) return null;
  let text = date.trim();
  if (o.format === "long") {
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) text = m[3] ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }
  if (o.time && time?.trim()) text += `, ${time.trim()}`;
  if (o.caps) text = text.toUpperCase();
  return { kind: "date", runs: [{ text }], style: { align: o.align, size: o.size, italic: o.italic, bold: o.bold } };
}
