/** The format a book's folder and project note are saved in, and what is out of step with this version of Booker. Pure.
 *  Version 1 is any book saved before the number existed. Version 2 records the empty chapters and acts the author made on purpose. */

export const PROJECT_FORMAT_VERSION = 2;

export type VersionState = "ok" | "older" | "newer";

export interface VersionFacts {
  /** the number in the project note; undefined for a book saved before there was one */
  formatVersion: number | undefined;
  /** the System files that should exist and do not */
  missingSystem: string[];
  /** the book has scenes but its project note has no structure and one could be worked out */
  structureMissing: boolean;
  hasBookId: boolean;
  /** chapters and acts with no scene, in a book from before they were recorded as chosen */
  legacyEmpties: number;
}

export interface VersionProblem {
  id: "version" | "system" | "structure" | "bookId" | "empties";
  message: string;
}

export interface VersionReport {
  state: VersionState;
  stored: number;
  current: number;
  problems: VersionProblem[];
}

export function checkVersion(f: VersionFacts, current = PROJECT_FORMAT_VERSION): VersionReport {
  const stored = f.formatVersion ?? 1;
  const state: VersionState = stored > current ? "newer" : stored < current ? "older" : "ok";
  const problems: VersionProblem[] = [];
  if (state === "older") problems.push({ id: "version", message: f.formatVersion === undefined ? "Saved by an older Booker that did not number its books." : `Saved in format ${stored}; this Booker uses ${current}.` });
  if (state === "newer") return { state, stored, current, problems };
  if (f.missingSystem.length) problems.push({ id: "system", message: `Missing system file${f.missingSystem.length === 1 ? "" : "s"}: ${f.missingSystem.join(", ")}.` });
  if (f.structureMissing) problems.push({ id: "structure", message: "The project note does not say how the book is divided (acts, chapters, scenes)." });
  if (!f.hasBookId) problems.push({ id: "bookId", message: "The book has no id, which series and backups use to recognise it." });
  if (state === "older" && f.legacyEmpties > 0) problems.push({ id: "empties", message: `${f.legacyEmpties} empty chapter${f.legacyEmpties === 1 ? "" : "s"} or act${f.legacyEmpties === 1 ? "" : "s"} are remembered with no files behind them.` });
  return { state: problems.length ? (state === "ok" ? "older" : state) : state, stored, current, problems };
}
