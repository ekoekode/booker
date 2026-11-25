import { DEFAULT_OPENING, type Opening } from "./writing/initials";
import { DEFAULT_FORMAT, WritingFormat } from "./writing/format";
import type { ExportOptions } from "./export/gather";
import type { OpenIn, ViewsIn } from "./openTarget";

export const STATUSES = ["idea", "outline", "draft", "revised", "final"] as const;
export type Status = (typeof STATUSES)[number];

export interface BookerSettings {
  exportFolder: string;
  detectNames: boolean;
  /** the Insert / Read bar over scripture references, and Shift+Space to fill one in */
  scriptureAssist: boolean;
  /** hover or Shift+Space on a plain word offers richer words; off by default */
  vocabSuggest: boolean;
  /** write scene summaries in the background (needs the writing model) */
  autoSceneSummaries: boolean;
  /** keep every tool in the ribbon, whatever kind of book is open */
  showAllTools: boolean;
  openChaptersIn: OpenIn;
  /** where charts, stats, plotlines and other Booker views open */
  openViewsIn: ViewsIn;
  /** the writing area counts as wide from this many pixels, so a view may split to the right */
  wideAt: number;
  /** hide Obsidian's Properties block in notes that belong to a project */
  hideProperties: boolean;
  /** hide the Markdown marks around bold, italic and similar words while editing */
  hideMarks: boolean;
  /** look for a newer Booker once a day: not asked yet, yes, or no */
  updateCheck: "ask" | "on" | "off";
  /** when it last looked, in ms */
  lastUpdateCheck: number;
  /** colour what your own notes quote in the Reader, with a Go to button */
  showQuoted: boolean;
  projectRoot: string;
  writing: WritingFormat;
  /** the large first letter of a chapter */
  opening: Opening;
  autoLinkIdleMs: number;
  autoLinkMatchCase: "ignore" | "respect";
  dailyGoal: number;
  authorName: string;
  authorSurname: string;
  authorContact: string;
  sceneBreak: string;
  exportMinStatus: Status;
  trimSize: "5.5x8.5" | "6x9" | "5x8" | "a5";
  timelineMoveScenesWithLife: boolean;
  /** which engine draws the real-world map: auto picks WebGL when the computer has real hardware WebGL, else the compatible one */
  mapRenderer: "auto" | "webgl" | "compatible";
}

export const DEFAULT_SETTINGS: BookerSettings = {
  exportFolder: "Booker Exports",
  detectNames: true,
  scriptureAssist: true,
  vocabSuggest: false,
  autoSceneSummaries: false,
  showAllTools: false,
  openChaptersIn: "first",
  openViewsIn: "auto",
  wideAt: 1100,
  hideProperties: true,
  hideMarks: true,
  updateCheck: "ask",
  lastUpdateCheck: 0,
  showQuoted: true,
  projectRoot: "Booker",
  writing: DEFAULT_FORMAT,
  opening: DEFAULT_OPENING,
  autoLinkIdleMs: 1200,
  autoLinkMatchCase: "ignore",
  dailyGoal: 1000,
  authorName: "",
  authorSurname: "",
  authorContact: "",
  sceneBreak: "* * *",
  exportMinStatus: "draft",
  trimSize: "5.5x8.5",
  timelineMoveScenesWithLife: false,
  mapRenderer: "auto",
};

export const SETTINGS_VERSION = 5;

export interface PersistedData {
  /** bumped when a default changes and saved settings need a one-time update */
  settingsVersion?: number;
  settings: BookerSettings;
  /** path -> word count, so edits can be counted as deltas */
  wordCounts: Record<string, number>;
  days: Record<string, DayStats>;
  exportOptions?: Partial<ExportOptions>;
  /** named export settings the user saved */
  exportPresets?: Record<string, Partial<ExportOptions>>;
  /** words the author chose to hide from the "words you lean on" list, per project note path */
  ignoredWords?: Record<string, string[]>;
  /** project health warnings the author dismissed, per project note path (see findingId) */
  dismissedHealth?: Record<string, string[]>;
  /** finished writing sprints, newest last */
  sprints?: import("./sprint").SprintRecord[];
  /** per-project backup settings, keyed by the project note's path */
  /** scripture insert: modules folder, last module and verse style */
  scripture?: import("./scripture/insertModal").ScriptureData;
  backups?: Record<string, import("./backup/plan").BackupConfig>;
  /** dictionaries from the plugin folder already added to the library (id to data version), so one the author removed stays removed */
  bundledDictionaries?: Record<string, string>;
  /** the one-time notice that backups go to a folder outside the vault has been shown */
  backupFolderTold?: boolean;
}

export interface DayStats {
  /** net words after deletions */
  net: number;
  /** only words added (sum of positive deltas) */
  added: number;
}
