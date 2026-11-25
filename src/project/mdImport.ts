/** Turn a Markdown manuscript into acts, chapters and numbered sections. Pure: nothing here touches the vault. */

export interface ImportChapter {
  title: string;
  /** Section texts in reading order; they are named "Scene 1", "Scene 2"… across the book */
  sections: string[];
}

export interface ImportAct {
  /** The heading text of a "Part" or "Act" heading; undefined for chapters before any such heading. */
  title?: string;
  chapters: ImportChapter[];
}

export interface ImportPlan {
  acts: ImportAct[];
  words: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BREAK_RE = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const FENCE_RE = /^\s*(```|~~~)/;

/** Drop heading attributes such as {#anchor .class} and turn [text](#link) into text. */
export function cleanHeading(t: string): string {
  return t.replace(/\s*\{[^{}]*\}\s*$/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s*#+\s*$/, "").trim();
}

/** Choices for reading a manuscript. All optional: the defaults are the original behaviour. */
export interface ImportOptions {
  /** Headings of this level or higher (1 = #, 2 = ##…) start a chapter; deeper headings stay in the text. 0 = every heading. */
  chapterLevel?: number;
  /** Words that mark an act or part heading, comma separated ("Part, Act, Book"); empty turns acts off. */
  actWords?: string;
  /** An extra line that splits sections: a regular expression, or plain text matched as the whole line. */
  breakPattern?: string;
  /** Title of the chapter made from text before the first heading. */
  introTitle?: string;
}

export const DEFAULT_ACT_WORDS = "Part, Act";

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function actRegex(words: string | undefined): RegExp | null {
  const list = (words ?? DEFAULT_ACT_WORDS).split(",").map((w) => w.trim()).filter(Boolean);
  return list.length ? new RegExp(`^#{1,6}\\s+((?:${list.map(escapeRe).join("|")})\\b.*)$`, "i") : null;
}

function breakRegex(pattern: string | undefined): RegExp | null {
  const t = pattern?.trim();
  if (!t) return null;
  try {
    return new RegExp(t);
  } catch {
    return new RegExp(`^\\s*${escapeRe(t)}\\s*$`);
  }
}

const count = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/**
 * Part/Act headings start an act; every other heading starts a chapter and gives it its title;
 * lines of `***`, `---` or `* * *` split a chapter into sections. Text before the first heading becomes
 * a chapter called `introTitle`. Front matter at the top of the file is dropped.
 */
export function planMarkdownImport(markdown: string, opts: ImportOptions | string = {}): ImportPlan {
  const o: ImportOptions = typeof opts === "string" ? { introTitle: opts } : opts;
  const introTitle = o.introTitle || "Introduction";
  const actRe = actRegex(o.actWords);
  const extraBreak = breakRegex(o.breakPattern);
  const level = o.chapterLevel ?? 0;
  const text = markdown.replace(/^﻿/, "").replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const acts: ImportAct[] = [];
  let act: ImportAct | null = null;
  let chapter: ImportChapter | null = null;
  let buf: string[] = [];
  let words = 0;
  let fenced = false;

  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (!body) return;
    if (!chapter) startChapter(introTitle);
    chapter!.sections.push(body);
    words += count(body);
  };
  const startAct = (title?: string) => {
    act = { title, chapters: [] };
    acts.push(act);
  };
  const startChapter = (title: string) => {
    if (!act) startAct();
    chapter = { title, sections: [] };
    act!.chapters.push(chapter);
  };

  for (const line of text.split(/\r?\n/)) {
    if (FENCE_RE.test(line)) fenced = !fenced;
    if (!fenced) {
      const a = actRe?.exec(line);
      if (a) {
        flush();
        chapter = null;
        startAct(cleanHeading(a[1]));
        continue;
      }
      const h = HEADING_RE.exec(line);
      if (h && (level === 0 || h[1].length <= level)) {
        flush();
        startChapter(cleanHeading(h[2]));
        continue;
      }
      if (BREAK_RE.test(line) || extraBreak?.test(line)) {
        flush();
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  // a heading with no text under it is still a chapter, with one empty section left out
  return { acts, words };
}

export function planTotals(plan: ImportPlan): { acts: number; chapters: number; sections: number; words: number } {
  const chapters = plan.acts.flatMap((a) => a.chapters);
  return { acts: plan.acts.filter((a) => a.title !== undefined).length, chapters: chapters.length, sections: chapters.reduce((n, c) => n + c.sections.length, 0), words: plan.words };
}

/**
 * Split one note's text into scenes at scene-break lines (`***`, `---`, `___`, `* * *`, or `breakPattern`).
 * Code fences are skipped, and a `---` straight under a line of text is a heading underline, not a break.
 * Empty sections are dropped; a text with no break comes back as one section.
 */
export function splitOnBreaks(body: string, breakPattern?: string): string[] {
  const extra = breakRegex(breakPattern);
  const out: string[] = [];
  let buf: string[] = [];
  let fenced = false;
  let prev = "";
  const flush = () => {
    const t = buf.join("\n").trim();
    buf = [];
    if (t) out.push(t);
  };
  for (const line of body.split(/\r?\n/)) {
    if (FENCE_RE.test(line)) fenced = !fenced;
    const underline = /^\s*-{2,}\s*$/.test(line) && prev.trim() !== "" && !BREAK_RE.test(prev);
    if (!fenced && !underline && (BREAK_RE.test(line) || extra?.test(line))) flush();
    else buf.push(line);
    prev = line;
  }
  flush();
  return out.length ? out : [body.trim()];
}
