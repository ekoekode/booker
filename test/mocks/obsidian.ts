/** Just enough of the Obsidian API to run the plugin's vault logic against a folder on disk. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename as pbasename, extname } from "node:path";
import { parse } from "yaml";

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}
export class TFile extends TAbstractFile {
  basename = "";
  extension = "";
  stat = { mtime: 1, ctime: 1, size: 0 };
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot() {
    return this.path === "/";
  }
}

export function debounce<T extends (...a: any[]) => any>(fn: T) {
  return fn;
}
export function normalizePath(p: string) {
  return p.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
}
export class Notice {
  constructor(public msg?: string) {}
}
export class Events {
  on(_name?: string, _cb?: (...a: any[]) => any): any {
    return {};
  }
  off() {}
  trigger() {}
}
export class Modal {}
export class Plugin {}
export class Menu {
  addItem(cb: (i: any) => void) {
    const i: any = { setTitle: () => i, setIcon: () => i, onClick: () => i, setDisabled: () => i };
    cb(i);
    return this;
  }
  addSeparator() {
    return this;
  }
  showAtMouseEvent() {}
  showAtPosition() {}
}
export class WorkspaceLeaf {}
export function setIcon(el: HTMLElement, name: string) {
  el.setAttribute("data-icon", name);
}

/** Obsidian's DOM helpers on jsdom elements (only when a DOM exists, i.e. under `@vitest-environment jsdom`). */
function installDomHelpers() {
  if (typeof Element === "undefined") return;
  const P: any = Element.prototype;
  if (P.createEl) return;
  const make = (parent: any, tag: string, o?: any) => {
    const opts = typeof o === "string" ? { cls: o } : o ?? {};
    const e: any = (parent.ownerDocument ?? document).createElement(tag);
    if (opts.cls) e.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
    if (opts.text !== undefined) e.textContent = String(opts.text);
    if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) e.setAttribute(k, String(v));
    if (opts.title) e.title = opts.title;
    if (opts.type) e.type = opts.type;
    if (opts.value !== undefined) e.value = opts.value;
    if (opts.href) e.setAttribute("href", opts.href);
    parent.appendChild(e);
    return e;
  };
  P.createEl = function (tag: string, o?: any) {
    return make(this, tag, o);
  };
  P.createDiv = function (o?: any) {
    return make(this, "div", o);
  };
  P.createSpan = function (o?: any) {
    return make(this, "span", o);
  };
  P.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  P.addClass = function (...c: string[]) {
    this.classList.add(...c.flatMap((x) => x.split(/\s+/).filter(Boolean)));
  };
  P.removeClass = function (...c: string[]) {
    this.classList.remove(...c.flatMap((x) => x.split(/\s+/).filter(Boolean)));
  };
  P.toggleClass = function (c: string, on: boolean) {
    this.classList.toggle(c, on);
  };
  P.hasClass = function (c: string) {
    return this.classList.contains(c);
  };
  P.setText = function (t: string) {
    this.textContent = t;
  };
  P.setAttr = function (k: string, v: string) {
    this.setAttribute(k, v);
  };
  P.appendText = function (t: string) {
    this.appendChild(document.createTextNode(t));
  };
  P.find = function (sel: string) {
    return this.querySelector(sel);
  };
  P.findAll = function (sel: string) {
    return Array.from(this.querySelectorAll(sel));
  };
}
installDomHelpers();

export class ItemView {
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(public leaf: any) {
    installDomHelpers();
    if (typeof document !== "undefined") {
      this.containerEl = document.createElement("div");
      const header = document.createElement("div");
      this.contentEl = document.createElement("div");
      this.contentEl.className = "view-content";
      this.containerEl.append(header, this.contentEl);
    } else {
      this.containerEl = this.contentEl = undefined as any;
    }
  }
  app: any = undefined;
  private cleanups: (() => void)[] = [];
  register(fn: () => void) {
    this.cleanups.push(fn);
  }
  registerEvent(_e: any) {}
  registerDomEvent() {}
  registerInterval() {
    return 0;
  }
  getState() {
    return {};
  }
  async setState(_s: any, _r: any) {}
  async close() {
    this.cleanups.forEach((f) => f());
  }
}
export class PluginSettingTab {}
export class Setting {}
export class FuzzySuggestModal {}
export class EditorSuggest {}
export class MarkdownView {}
export const Platform = { isMobile: false, isDesktopApp: true };

export class MockVault {
  root = Object.assign(new TFolder(), { path: "/", name: "" });
  files = new Map<string, TFile>();
  folders = new Map<string, TFolder>();
  contents = new Map<string, string>();

  /** `dir` is mounted as a top-level folder (named after its basename) so a project folder is not the vault root, as in Obsidian. */
  constructor(dir: string) {
    this.folders.set("/", this.root);
    const name = pbasename(dir);
    const top = Object.assign(new TFolder(), { path: name, name, parent: this.root });
    this.root.children.push(top);
    this.folders.set(name, top);
    this.load(dir, top, name);
  }

  private load(dir: string, parent: TFolder, rel: string) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) {
        const f = Object.assign(new TFolder(), { path, name, parent });
        parent.children.push(f);
        this.folders.set(path, f);
        this.load(full, f, path);
      } else if (name.endsWith(".md")) {
        const text = readFileSync(full, "utf8");
        const f = Object.assign(new TFile(), { path, name, parent, extension: "md", basename: pbasename(name, extname(name)) });
        f.stat = { mtime: 1, ctime: 1, size: text.length };
        parent.children.push(f);
        this.files.set(path, f);
        this.contents.set(path, text);
      }
    }
  }

  frontmatter(file: TFile): Record<string, any> | undefined {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(this.contents.get(file.path) ?? "");
    if (!m) return undefined;
    try {
      return parse(m[1]) ?? {};
    } catch {
      return undefined;
    }
  }
}

export function mockApp(vault: MockVault): any {
  /** Every processFrontMatter call: the file and the keys the callback changed (or set). */
  const fmWrites: { path: string; keys: string[]; fm: Record<string, any> }[] = [];
  return {
    fmWrites,
    vault: {
      getMarkdownFiles: () => [...vault.files.values()],
      getFolderByPath: (p: string) => vault.folders.get(p) ?? null,
      getFileByPath: (p: string) => vault.files.get(p) ?? null,
      getAbstractFileByPath: (p: string) => vault.files.get(p) ?? vault.folders.get(p) ?? null,
      getRoot: () => vault.root,
      cachedRead: async (f: TFile) => vault.contents.get(f.path) ?? "",
      read: async (f: TFile) => vault.contents.get(f.path) ?? "",
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: (f: TFile) => ({ frontmatter: vault.frontmatter(f) }),
      getFirstLinkpathDest: (target: string, _from: string) => {
        const t = target.replace(/\.md$/, "").toLowerCase();
        const hits = [...vault.files.values()].filter((f) => f.basename.toLowerCase() === t || f.path.toLowerCase().replace(/\.md$/, "") === t);
        return hits.sort((a, b) => a.path.length - b.path.length)[0] ?? null;
      },
      on: () => ({}),
    },
    workspace: {
      getActiveFile: () => null,
      on: () => ({}),
      getLeaf: () => ({ openFile: async () => {} }),
      getLeavesOfType: () => [],
      onLayoutReady: (cb: () => void) => cb(),
    },
    fileManager: { processFrontMatter: async (f: TFile, fn: (fm: Record<string, any>) => void) => {
        const fm = structuredClone(vault.frontmatter(f) ?? {});
        const before = structuredClone(fm);
        fn(fm);
        const keys = Object.keys({ ...before, ...fm }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(fm[k]));
        fmWrites.push({ path: f.path, keys, fm });
      }, renameFile: async () => {}, trashFile: async () => {} },
  };
}
