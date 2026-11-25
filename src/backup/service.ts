/** Connects the backup engine to Obsidian: which vault files make up a project, and where backups are kept. */
import { App, Platform, TFile } from "obsidian";
import type { Project } from "../project/vaultOps";
import { runBackup, type BackupSource, type RunResult, type Sink } from "./run";
import type { BackupConfig } from "./plan";

const CODEX_PREFIX = "_SeriesCodex";

export function vaultSource(app: App, proj: Project, includeCodex: boolean): BackupSource {
  const base = proj.layout.base;
  const parent = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  const codex = proj.series && includeCodex ? `${proj.series.folder}/Codex/` : null;
  const files = () => {
    const out: Array<{ file: TFile; path: string }> = [];
    for (const f of app.vault.getFiles()) {
      if (f.path.startsWith(base + "/")) out.push({ file: f, path: f.path.slice(parent.length) });
      else if (codex && f.path.startsWith(codex)) out.push({ file: f, path: `${CODEX_PREFIX}/${f.path.slice(codex.length)}` });
    }
    return out;
  };
  let byPath = new Map<string, TFile>();
  return {
    async list() {
      const all = files();
      byPath = new Map(all.map((x) => [x.path, x.file]));
      return all.map((x) => ({ path: x.path, size: x.file.stat.size, mtime: x.file.stat.mtime }));
    },
    async read(path) {
      const f = byPath.get(path);
      if (!f) throw new Error(`Missing ${path}`);
      return new Uint8Array(await app.vault.readBinary(f));
    },
  };
}

const nodeFs = (): any | null => {
  try {
    return Platform.isDesktopApp ? (window as any).require("fs") : null;
  } catch {
    return null;
  }
};

/** Where backups go until you choose: Documents/Booker Backups on a computer, a Booker Backups folder in the vault elsewhere. */
export function defaultBackupDir(): string {
  try {
    if (Platform.isDesktopApp) return `${(window as any).require("os").homedir().replace(/\\/g, "/")}/Documents/Booker Backups`;
  } catch {
    /* fall through to the vault */
  }
  return "Booker Backups";
}

export const canUseAnyFolder = () => !!nodeFs();

/** A folder on this computer (desktop), or a folder in the vault (everywhere). */
export function makeSink(app: App, dir: string): Sink {
  const fs = nodeFs();
  if (fs && /^([a-zA-Z]:)?[\\/]/.test(dir)) {
    const fsp = fs.promises;
    const abs = (p: string) => `${dir.replace(/[\\/]+$/, "")}/${p}`;
    return {
      mkdirp: (d) => fsp.mkdir(abs(d), { recursive: true }),
      async write(p, data) {
        await fsp.mkdir(abs(p.slice(0, Math.max(0, p.lastIndexOf("/")))), { recursive: true });
        await fsp.writeFile(abs(p), typeof data === "string" ? data : Buffer.from(data));
      },
      async read(p) {
        try {
          return new Uint8Array(await fsp.readFile(abs(p)));
        } catch (e: any) {
          if (e?.code === "ENOENT") return null;
          throw e;
        }
      },
      async list(d) {
        try {
          return (await fsp.readdir(abs(d), { withFileTypes: true })).map((e: any) => ({ name: e.name, isDir: e.isDirectory() }));
        } catch (e: any) {
          if (e?.code === "ENOENT") return [];
          throw e;
        }
      },
      remove: (p) => fsp.rm(abs(p), { recursive: true, force: true }),
    };
  }
  const a = app.vault.adapter;
  const abs = (p: string) => `${dir.replace(/\/+$/, "")}/${p}`.replace(/^\/+/, "");
  const mk = async (d: string) => {
    let cur = "";
    for (const part of d.split("/").filter(Boolean)) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await a.exists(cur))) await a.mkdir(cur);
    }
  };
  return {
    mkdirp: (d) => mk(abs(d)),
    async write(p, data) {
      await mk(abs(p.slice(0, Math.max(0, p.lastIndexOf("/")))));
      if (typeof data === "string") await a.write(abs(p), data);
      else await a.writeBinary(abs(p), data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    },
    async read(p) {
      return (await a.exists(abs(p))) ? new Uint8Array(await a.readBinary(abs(p))) : null;
    },
    async list(d) {
      if (!(await a.exists(abs(d)))) return [];
      const l = await a.list(abs(d));
      const name = (x: string) => x.slice(x.lastIndexOf("/") + 1);
      return [...l.folders.map((x) => ({ name: name(x), isDir: true })), ...l.files.map((x) => ({ name: name(x), isDir: false }))];
    },
    remove: async (p) => {
      if (!(await a.exists(abs(p)))) return;
      const st = await a.stat(abs(p));
      if (st?.type === "folder") await a.rmdir(abs(p), true);
      else await a.remove(abs(p));
    },
  };
}

export function backupProject(app: App, proj: Project, cfg: BackupConfig): Promise<RunResult> {
  return runBackup(proj.name, vaultSource(app, proj, cfg.includeCodex), makeSink(app, cfg.dir), cfg);
}

/** Writes restored files into the vault as new notes. */
export function vaultWriter(app: App) {
  return {
    async write(path: string, data: Uint8Array) {
      const parts = path.split("/");
      let cur = "";
      for (const part of parts.slice(0, -1)) {
        cur = cur ? `${cur}/${part}` : part;
        if (!app.vault.getFolderByPath(cur)) await app.vault.createFolder(cur);
      }
      await app.vault.createBinary(path, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    },
  };
}
