import type { App } from "obsidian";
import type { Project } from "./vaultOps";

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
}

/** Your own checklist for a book, plus which of the built-in first steps you have hidden. Kept in System/tasks.json. */
export interface TaskFile {
  tasks: TaskItem[];
  hidden: string[];
}

export function parseTasks(raw: string | null | undefined): TaskFile {
  let j: any = {};
  try {
    j = raw ? JSON.parse(raw) : {};
  } catch {
    j = {};
  }
  const tasks = Array.isArray(j.tasks) ? j.tasks.filter((t: any) => t && typeof t.text === "string").map((t: any) => ({ id: String(t.id ?? t.text), text: t.text, done: t.done === true })) : [];
  const hidden = Array.isArray(j.hidden) ? j.hidden.map(String) : [];
  return { tasks, hidden };
}

export function addTask(f: TaskFile, text: string): TaskFile {
  const t = text.trim();
  if (!t) return f;
  return { ...f, tasks: [...f.tasks, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: t, done: false }] };
}

export const toggleTask = (f: TaskFile, id: string): TaskFile => ({ ...f, tasks: f.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) });
export const removeTask = (f: TaskFile, id: string): TaskFile => ({ ...f, tasks: f.tasks.filter((t) => t.id !== id) });
export const hideStep = (f: TaskFile, id: string): TaskFile => ({ ...f, hidden: [...new Set([...f.hidden, id])] });
export const showSteps = (f: TaskFile): TaskFile => ({ ...f, hidden: [] });

const pathOf = (p: Project) => `${p.layout.system}/tasks.json`;

export async function readTasks(app: App, p: Project): Promise<TaskFile> {
  const path = pathOf(p);
  return parseTasks(await app.vault.adapter.exists(path).then((e) => (e ? app.vault.adapter.read(path) : null)));
}

export async function writeTasks(app: App, p: Project, f: TaskFile): Promise<void> {
  await app.vault.adapter.write(pathOf(p), JSON.stringify(f, null, 2));
}
