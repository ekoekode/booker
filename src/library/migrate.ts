/** Moving a library from the older folders (Sources/, Booker/Bibles) into Booker/Library. */
import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import type BookerPlugin from "../main";
import { ConfirmModal } from "../ui";
import { LEGACY_BIBLES, LEGACY_SOURCES, LIB_BIBLES, folderPath } from "./paths";

export interface Move {
  from: string;
  to: string;
}

/** Where each old source folder goes: a folder holding a database goes to Databases, anything else to Documents. Pure. */
export function planSourceMoves(folders: string[], dbFolders: Set<string>): Move[] {
  return folders.map((from) => ({ from, to: `${folderPath(dbFolders.has(from) ? "Databases" : "Documents")}/${from.slice(from.lastIndexOf("/") + 1)}` }));
}

async function ensure(plugin: BookerPlugin, dir: string) {
  let cur = "";
  for (const p of dir.split("/")) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await plugin.app.vault.adapter.exists(cur))) await plugin.app.vault.adapter.mkdir(cur);
  }
}

/** Move the old folders into the library. Nothing is overwritten: a name already taken is left where it is. */
export async function migrateLibrary(plugin: BookerPlugin): Promise<{ moved: number; left: number }> {
  const { app } = plugin;
  const moves: Move[] = [];
  const bibles = app.vault.getAbstractFileByPath(LEGACY_BIBLES);
  if (bibles instanceof TFolder) for (const c of bibles.children) moves.push({ from: c.path, to: `${LIB_BIBLES}/${c.name}` });
  const root = app.vault.getAbstractFileByPath(LEGACY_SOURCES);
  if (root instanceof TFolder) {
    const dbFolders = new Set(plugin.sources().filter((s) => s.kind === "db").map((s) => s.file.slice(0, s.file.lastIndexOf("/"))));
    moves.push(...planSourceMoves(root.children.filter((c) => c instanceof TFolder).map((c) => c.path), dbFolders));
  }
  await ensure(plugin, LIB_BIBLES);
  await ensure(plugin, folderPath("Databases"));
  await ensure(plugin, folderPath("Documents"));
  let moved = 0;
  let left = 0;
  const renamed = new Map<string, string>();
  for (const m of moves) {
    const f = app.vault.getAbstractFileByPath(m.from);
    if (!f || (await app.vault.adapter.exists(normalizePath(m.to)))) {
      left++;
      continue;
    }
    await app.fileManager.renameFile(f, normalizePath(m.to));
    renamed.set(m.from, m.to);
    moved++;
  }
  const d = plugin.scriptureData();
  const def = d.defaultModule && renamed.get(d.defaultModule);
  if (def) await plugin.saveScripture({ ...d, defaultModule: def });
  plugin.modules.forget();
  return { moved, left };
}

export function runMigration(plugin: BookerPlugin) {
  const old = (path: string) => {
    const f = plugin.app.vault.getAbstractFileByPath(path);
    return f instanceof TFolder && f.children.length > 0;
  };
  if (!old(LEGACY_BIBLES) && !old(LEGACY_SOURCES)) return void new Notice("Booker: nothing to move. Your library is already in Booker/Library.");
  new ConfirmModal(plugin.app, "Move into the library?", "Your Bibles (Booker/Bibles) and documents (Sources) move into Booker/Library. Files are moved, not copied, and links to them are kept.", "Move", () => void migrate(plugin)).open();
}

async function migrate(plugin: BookerPlugin) {
  try {
    const r = await migrateLibrary(plugin);
    new Notice(`Booker: moved ${r.moved} item${r.moved === 1 ? "" : "s"} into Booker/Library${r.left ? `; ${r.left} left where they were (the name was taken)` : ""}.`, 10000);
  } catch (e) {
    new Notice(`Booker: could not move the library. ${e instanceof Error ? e.message : e}`, 10000);
  }
}
