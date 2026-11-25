import type { StyleId } from "../citations/styles";
import type { Status } from "../types";
import type { ActDoc, ChapterDoc } from "./model";
import type { Advanced } from "./layout";
import type { NoteNumbering, NotePlacement } from "./notes";

export type Preset = "manuscript" | "trade";
export type BreakStyle = "custom" | "stars" | "dots" | "line" | "space";
export type ChapterStyle = "number-title" | "title" | "number";

export interface SceneDateOptions {
  on: boolean;
  align: "left" | "center" | "right";
  /** percentage of the body text size */
  size: number;
  italic: boolean;
  bold: boolean;
  caps: boolean;
  /** "written" keeps the text as typed; "long" spells a real date out (March 12, 1891) */
  format: "written" | "long";
  /** add the Time property after the date */
  time: boolean;
}

export const DEFAULT_SCENE_DATES: SceneDateOptions = { on: false, align: "center", size: 115, italic: true, bold: false, caps: false, format: "written", time: false };

export interface ExportOptions {
  docx: boolean;
  epub: boolean;
  pdf: boolean;
  /** manuscript = agent/editor submission; trade = reader-facing book */
  preset: Preset;
  minStatus: Status;
  /** lowest status to include; scenes below it are left out */
  minSceneStatus?: string;
  lineBreaksAreParagraphs: boolean;
  smartQuotes: boolean;
  sceneBreak: string;
  /** how a scene break looks in a book: the custom mark above, or a ready-made one */
  breakStyle?: BreakStyle;
  /** print each section's story date above it, styled as chosen (the date comes from the section's Date property) */
  sceneDates?: SceneDateOptions;
  /** print each scene's title as a small heading above it */
  sceneTitles?: boolean;
  chapterStyle: ChapterStyle;
  /** the large first letter of each chapter (default: none) */
  opening?: import("../writing/initials").Opening;
  actTitles: boolean;
  trimSize: "5.5x8.5" | "6x9" | "5x8" | "a5";
  /** where footnotes are printed (default: the foot of the page, or the end of each chapter where pages do not exist) */
  notePlacement?: NotePlacement;
  /** whether note numbers start again in each chapter (default) or run through the book */
  noteNumbering?: NoteNumbering;
  /** list the cited sources at the end of the book (default: yes, when anything is cited) */
  bibliography?: boolean;
  /** list every scripture reference with the chapters it appears in (default: on when the book's template has a scripture index) */
  scriptureIndex?: boolean;
  /** print the index of the terms listed in the project note's indexTerms property (default: yes when there are terms) */
  bookIndex?: boolean;
  /** write "Ibid." when a note cites the source of the note before it (Chicago and SBL) */
  ibid?: boolean;
  /** how citations and the bibliography are written (default: the book's profile) */
  citationStyle?: StyleId;
  /** overrides from the Advanced window; anything left out follows the chosen look */
  advanced?: Advanced;
}


/** The text a book draws between scenes for the chosen style (manuscripts always use #). */
export function breakMark(opts: Pick<ExportOptions, "sceneBreak" | "breakStyle">): string {
  switch (opts.breakStyle) {
    case "stars":
      return "* * *";
    case "dots":
      return "\u2022 \u2022 \u2022";
    case "line":
      return "\u2014\u2014\u2014";
    case "space":
      return "\u00A0";
    default:
      return opts.sceneBreak || "* * *";
  }
}

export function chapterHeading(c: ChapterDoc, style: ChapterStyle): { label: string; title: string } {
  if (c.back) return { label: "", title: c.title };
  const word = c.word ?? "Chapter";
  const numbered = `${word} ${c.number}`;
  const generic = new RegExp(`^(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\d+|\\d+)$`, "i").test(c.title.trim());
  switch (style) {
    case "number":
      return { label: numbered, title: "" };
    case "title":
      return { label: "", title: c.title };
    default:
      return { label: numbered, title: generic ? "" : c.title };
  }
}

export function actHeading(a: ActDoc): string {
  if (a.number === 0 && a.title) return a.title; // a Prologue is not “Part Zero”
  const word = a.word ?? "Part";
  const generic = new RegExp(`^(act|part|${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*([\\divxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)$`, "i").test(a.title.trim());
  return generic ? a.title : `${word} ${toWords(a.number)}${a.title ? `: ${a.title}` : ""}`;
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
function toWords(n: number): string {
  return WORDS[n] ?? String(n);
}
