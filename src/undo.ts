/**
 * Undo for actions that change several notes at once (split a scene, apply a beat sheet, merge, delete, add names).
 * Before the action the touched notes are copied; afterwards, notes the action created are noted. Undo puts the
 * copies back and removes what was created. Pure: the vault is reached through a small adapter, so it is testable.
 */
export interface UndoVault {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** every note path under a folder */
  list(folder: string): string[];
}

interface Entry {
  label: string;
  before: Map<string, string | null>;
  created: string[];
}

export class UndoStack {
  private stack: Entry[] = [];

  constructor(private vault: UndoVault, private max = 30) {}

  get size() {
    return this.stack.length;
  }

  last(): string | undefined {
    return this.stack[this.stack.length - 1]?.label;
  }

  /** Run an action, remembering how to take it back. `touch` are the notes it may change or delete; `folder` is where it may create notes. */
  async run<T>(label: string, touch: string[], folder: string, fn: () => Promise<T>): Promise<T> {
    const before = new Map<string, string | null>();
    for (const p of new Set(touch)) before.set(p, await this.vault.read(p));
    const listed = new Set(this.vault.list(folder));
    const result = await fn();
    const created = this.vault.list(folder).filter((p) => !listed.has(p));
    this.stack.push({ label, before, created });
    while (this.stack.length > this.max) this.stack.shift();
    return result;
  }

  /** Take back the last action. Returns its label, or undefined when there is nothing to undo. */
  async undo(): Promise<string | undefined> {
    const e = this.stack.pop();
    if (!e) return undefined;
    for (const p of e.created) await this.vault.remove(p);
    for (const [p, text] of e.before) {
      if (text === null) await this.vault.remove(p);
      else await this.vault.write(p, text);
    }
    return e.label;
  }
}
