import { compareScenes, planMove, positionInAct, scenePath, type MoveOp, type SceneRef } from "./format";

export interface ArchivePlan {
  /** where the scene file goes */
  to: string;
  /** renumbering of the scenes left behind, closing the gap */
  ops: MoveOp[];
}

/** The first free path in `folder` for a file called `name`, trying "name 2", "name 3"… */
export function freePath(folder: string, name: string, taken: (path: string) => boolean): string {
  const m = /^(.*?)(\.[^.]+)?$/.exec(name)!;
  const stem = m[1];
  const ext = m[2] ?? "";
  let path = `${folder}/${name}`;
  for (let n = 2; taken(path); n++) path = `${folder}/${stem} ${n}${ext}`;
  return path;
}

/**
 * Take a scene out of the book. It keeps its act, chapter and text, so it can come back to the same place; the scenes
 * after it in its act move up one so their numbers stay in a row.
 */
export function planArchive(scenes: SceneRef[], path: string, scenesFolder: string, archiveFolder: string, taken: (p: string) => boolean): ArchivePlan | null {
  const gone = scenes.find((s) => s.path === path);
  if (!gone) return null;
  const rest = scenes.filter((s) => s.path !== path && String(s.act) === String(gone.act)).sort(compareScenes);
  const ops: MoveOp[] = [];
  rest.forEach((s, i) => {
    const seq = i + 1;
    const to = scenePath(scenesFolder, gone.act, seq, s.title);
    if (to !== s.path || s.sequence !== seq) ops.push({ from: s.path, to, patch: { sequence: seq } });
  });
  return { to: freePath(archiveFolder, path.split("/").pop()!, taken), ops };
}

/**
 * Put an archived scene back at the end of its chapter (or of its act when the chapter is gone). `archived` describes the
 * file in the archive folder; the result moves it into the scenes folder and renumbers its act.
 */
export function planRestore(scenes: SceneRef[], archived: SceneRef, scenesFolder: string): MoveOp[] {
  const all = [...scenes, archived];
  const chapter = archived.chapter ?? "";
  const position = positionInAct(all, archived.path, archived.act, chapter, Number.MAX_SAFE_INTEGER);
  return planMove(all, archived.path, { act: archived.act, chapter: archived.chapter, position }, scenesFolder);
}
