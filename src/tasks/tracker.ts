/** The jobs Booker runs in the background (summaries, indexing), so one window can show them. Pure. */

export type TaskState = "queued" | "running" | "done" | "failed" | "cancelled" | "skipped";

export interface BgTask {
  id: number;
  title: string;
  /** what it is doing now, or why it failed */
  detail: string;
  state: TaskState;
  done: number;
  total: number;
  added: number;
  started?: number;
  ended?: number;
  /** present while the task can be cancelled */
  cancel?: () => void;
}

const KEEP_FINISHED = 20;

export class TaskTracker {
  private list: BgTask[] = [];
  private next = 1;
  private listeners = new Set<() => void>();

  tasks(): BgTask[] {
    return this.list;
  }

  /** Tasks that are queued or running. */
  active(): number {
    return this.list.filter((t) => t.state === "queued" || t.state === "running").length;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  add(title: string, opts: { cancel?: () => void; state?: TaskState; total?: number } = {}): BgTask {
    const t: BgTask = { id: this.next++, title, detail: "", state: opts.state ?? "queued", done: 0, total: opts.total ?? 0, added: Date.now(), cancel: opts.cancel };
    if (t.state === "running") t.started = Date.now();
    this.list.push(t);
    this.emit();
    return t;
  }

  update(t: BgTask, patch: Partial<Pick<BgTask, "detail" | "done" | "total" | "title">>) {
    Object.assign(t, patch);
    this.emit();
  }

  start(t: BgTask) {
    t.state = "running";
    t.started = Date.now();
    this.emit();
  }

  finish(t: BgTask, state: "done" | "failed" | "cancelled" | "skipped", detail = "") {
    t.state = state;
    t.ended = Date.now();
    t.cancel = undefined;
    if (detail || state === "done") t.detail = detail;
    const finished = this.list.filter((x) => x.state !== "queued" && x.state !== "running");
    if (finished.length > KEEP_FINISHED) this.list = this.list.filter((x) => !finished.slice(0, finished.length - KEEP_FINISHED).includes(x));
    this.emit();
  }

  /** Drop a task that has not started. */
  remove(t: BgTask) {
    this.list = this.list.filter((x) => x !== t);
    this.emit();
  }

  clearFinished() {
    this.list = this.list.filter((t) => t.state === "queued" || t.state === "running");
    this.emit();
  }
}
