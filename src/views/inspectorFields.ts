import { fuzzyFilter } from "../fuzzyMatch";
import { setIcon, type App, type TFile } from "obsidian";
import { linkTargets } from "../text";
import { parseStoryDate } from "../dates";
import { notifyError } from "../ui";

// ------------------------------------------------------------------ pure helpers

/** "[[Name|alias]]", "Name" -> "Name". Empty when nothing usable is left. */
export function cleanLinkName(input: string): string {
  const s = String(input ?? "")
    .replace(/\[\[|\]\]/g, "")
    .split("|")[0]
    .split("#")[0]
    .replace(/[\r\n]+/g, " ")
    .trim();
  return s;
}

export function toLink(name: string): string {
  return `[[${cleanLinkName(name)}]]`;
}

/** A single link value for the frontmatter: `[[Name]]`, or null when the box is empty. */
export function linkValue(input: string): string | null {
  const n = cleanLinkName(input);
  return n ? toLink(n) : null;
}

/** Plain text for the frontmatter: null when empty, so no empty-string noise is written. */
export function textValue(input: string): string | null {
  const s = String(input ?? "").trim();
  return s ? s : null;
}

/** A number for the frontmatter: null when empty or not a positive number. */
export function numberValue(input: string): number | null {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Why an alias is not allowed, or null when it is fine. */
export function validateAlias(input: string): string | null {
  const s = String(input ?? "").trim();
  if (s.length < 2) return "An alias needs at least 2 characters.";
  if (/[\[\]|#^\r\n]/.test(s)) return "An alias cannot contain [ ] | # ^ or a line break.";
  return null;
}

/** The raw items of a list property (strings only, empties dropped). A lone string counts as one item. */
export function rawList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").map((v) => String(v));
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/** What a list item shows as: the link target for `[[Name]]` items, the text otherwise. */
export function itemName(raw: string): string {
  return linkTargets(raw)[0] ?? raw;
}

function same(a: string, b: string, asLink: boolean): boolean {
  return asLink ? itemName(a).toLowerCase() === cleanLinkName(b).toLowerCase() : a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The list with `name` added (as `[[Name]]` or plain text). Already-present names are not duplicated. */
export function addToList(current: unknown, name: string, asLink: boolean): string[] {
  const list = rawList(current);
  const clean = asLink ? cleanLinkName(name) : name.trim();
  if (!clean || list.some((x) => same(x, clean, asLink))) return list;
  return [...list, asLink ? toLink(clean) : clean];
}

export function removeFromList(current: unknown, name: string, asLink: boolean): string[] {
  return rawList(current).filter((x) => !same(x, name, asLink));
}

// ------------------------------------------------------------------ section state

/** Which sections the user collapsed. Lives as long as Obsidian is open. */
export const collapsed = new Map<string, boolean>();

// ------------------------------------------------------------------ DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

let uid = 0;

export interface FieldCtx {
  app: App;
  file: TFile;
  /** Current frontmatter of the note. */
  fm: Record<string, any>;
  /** Names for suggestion lists. */
  characters: string[];
  locations: string[];
  plotlines: string[];
  lives: string[];
}

/** Write to the note's frontmatter. Only the keys the callback touches change. */
export async function writeFm(ctx: Pick<FieldCtx, "app" | "file">, fn: (fm: Record<string, any>) => void): Promise<void> {
  try {
    await ctx.app.fileManager.processFrontMatter(ctx.file, (fm) => {
      const before = { ...fm };
      fn(fm);
      // a field cleared to null is removed rather than left as an empty property
      for (const k of Object.keys(fm)) if (fm[k] === null && before[k] !== null) delete fm[k];
    });
  } catch (e) {
    notifyError(e, "save this field");
  }
}

/** A collapsible group of fields. */
export function section(parent: HTMLElement, key: string, title: string, defaultOpen = true, loose = false): HTMLElement {
  const body = box(parent, title, { key, open: defaultOpen });
  if (loose) body.addClass("is-loose");
  return body;
}

/**
 * Fields sit in cells: the name is small and light at the top of the cell, the value under it. Cells in a row touch,
 * and a rounded box clips the corners of the rows it holds. A box can carry a label on its border.
 */
export function box(parent: HTMLElement, label?: string, opts: { key?: string; open?: boolean } = {}): HTMLElement {
  if (!label) return el(parent, "div", "booker-cells booker-cells-body");
  const key = opts.key ?? `box:${label}`;
  const open = collapsed.has(key) ? !collapsed.get(key) : opts.open ?? true;
  const outer = el(parent, "div", "booker-cells has-label");
  outer.toggleClass("is-folded", !open);
  const head = el(outer, "div", "booker-cells-label");
  head.tabIndex = 0;
  head.setAttr("role", "button");
  el(head, "span", undefined, label);
  setIcon(el(head, "span", "booker-cells-chev"), "chevron-down");
  const toggle = () => {
    outer.toggleClass("is-folded", !outer.hasClass("is-folded"));
    collapsed.set(key, outer.hasClass("is-folded"));
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  const fold = el(outer, "div", "booker-cells-fold");
  return el(el(fold, "div", "booker-cells-clip"), "div", "booker-cells-body");
}

/** A row of cells inside a box. Given anything else it makes a plain box first. */
export function line(parent: HTMLElement): HTMLElement {
  const holder = parent.hasClass("booker-cells-body") ? parent : box(parent);
  return el(holder, "div", "booker-cellrow");
}

/** The cell a field goes in: the parent when it is a row, a new row when it is a box, a box of its own otherwise. */
function field(parent: HTMLElement, label: string, _key?: string): HTMLElement {
  const row = parent.hasClass("booker-cellrow") ? parent : line(parent);
  const f = el(row, "div", "booker-cell");
  el(f, "label", "booker-cell-label", label);
  return f;
}

/** A read-only fact in a cell: a small label over the value. */
export function factCell(row: HTMLElement, label: string, value: string): HTMLElement {
  const f = field(row, label);
  el(f, "div", "booker-cell-value", value);
  return f;
}

/** A list of suggestions under the box that narrows as you type, and finds names even when they are misspelled or only partly typed. */
function datalist(parent: HTMLElement, input: HTMLInputElement, options: string[]): void {
  const box = el(parent, "div", "booker-fuzzy-list");
  box.hide();
  let at = -1;
  let shown: string[] = [];
  const draw = () => {
    box.empty();
    shown = fuzzyFilter(options, input.value, (o) => o).slice(0, 8);
    if (!input.value.trim() || !shown.length || (shown.length === 1 && shown[0] === input.value)) return void box.hide();
    shown.forEach((o, k) => {
      const row = el(box, "div", "booker-fuzzy-row" + (k === at ? " is-active" : ""), o);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(o);
      });
    });
    box.show();
  };
  const pick = (o: string) => {
    input.value = o;
    box.hide();
    at = -1;
    input.focus();
  };
  input.addEventListener("input", () => {
    at = -1;
    draw();
  });
  input.addEventListener("focus", draw);
  input.addEventListener("blur", () => box.hide());
  input.addEventListener("keydown", (e) => {
    if (!box.isShown()) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      draw();
    } else if (e.key === "Enter" && at >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(shown[at]);
    } else if (e.key === "Escape") box.hide();
  }, true);
}

export function selectField(parent: HTMLElement, ctx: FieldCtx, label: string, key: string, options: readonly string[], fallback: string) {
  const f = field(parent, label, key);
  const cur = typeof ctx.fm[key] === "string" && options.includes(ctx.fm[key]) ? ctx.fm[key] : fallback;
  const s = el(f, "select", "dropdown");
  for (const o of options) {
    const opt = el(s, "option", undefined, o);
    opt.value = o;
    if (o === cur) opt.selected = true;
  }
  s.onchange = () => void writeFm(ctx, (fm) => (fm[key] = s.value));
  return s;
}

/** Single-line text, link or number input that saves on change (blur or Enter). */
export function inputField(
  parent: HTMLElement,
  ctx: FieldCtx,
  label: string,
  key: string,
  opts: { kind?: "text" | "link" | "number"; suggestions?: string[]; placeholder?: string; note?: (v: string) => { text: string; bad: boolean } | null } = {},
) {
  const kind = opts.kind ?? "text";
  const f = field(parent, label, key);
  const input = el(f, "input", "booker-input");
  input.type = kind === "number" ? "number" : "text";
  if (kind === "number") input.setAttribute("inputmode", "numeric");
  if (opts.placeholder) input.placeholder = opts.placeholder;
  const raw = ctx.fm[key];
  input.value = kind === "link" ? (linkTargets(raw)[0] ?? "") : raw === null || raw === undefined ? "" : String(raw);
  if (opts.suggestions) datalist(f, input, opts.suggestions);
  const note = opts.note ? el(f, "div", "booker-field-note") : null;
  const showNote = () => {
    if (!note || !opts.note) return;
    const n = opts.note(input.value);
    note.setText(n?.text ?? "");
    note.toggleClass("booker-warn", !!n?.bad);
    note.style.display = n ? "" : "none";
  };
  showNote();
  input.addEventListener("input", showNote);
  input.onchange = () => {
    const value = kind === "link" ? linkValue(input.value) : kind === "number" ? numberValue(input.value) : textValue(input.value);
    void writeFm(ctx, (fm) => {
      fm[key] = value;
    });
  };
  return input;
}

/** The text box for when / when_end: shows what the date was understood as. */
export function dateField(parent: HTMLElement, ctx: FieldCtx, label: string, key: string) {
  return inputField(parent, ctx, label, key, {
    placeholder: "e.g. 1342-05-03 or spring 1342",
    note: (v) => {
      if (!v.trim()) return null;
      const d = parseStoryDate(v.trim());
      return d ? { text: d.display, bad: false } : { text: "not understood", bad: true };
    },
  });
}

/** Multi-line text that saves on blur or after 800 ms without typing. */
export function textareaField(parent: HTMLElement, ctx: FieldCtx, label: string, key: string, rows = 4) {
  const f = field(parent, label, key);
  f.addClass("is-wide");
  const ta = el(f, "textarea", "booker-textarea");
  ta.rows = rows;
  ta.value = typeof ctx.fm[key] === "string" ? ctx.fm[key] : "";
  let saved = ta.value;
  let timer: number | undefined;
  const save = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (ta.value === saved) return;
    const text = ta.value;
    saved = text;
    const v = textValue(text);
    void writeFm(ctx, (fm) => {
      fm[key] = v;
    });
  };
  ta.addEventListener("input", () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(save, 800);
  });
  ta.addEventListener("blur", save);
  return ta;
}

/** A list of chips with an x on each and an Add box. Links are stored as `[[Name]]`. */
export function chipsField(
  parent: HTMLElement,
  ctx: FieldCtx,
  label: string,
  key: string,
  opts: { asLink: boolean; suggestions?: string[]; validate?: (s: string) => string | null; /** a question about an item that does not stop it being added, shown under the field */ hint?: (s: string) => string | null; placeholder?: string; after?: (name: string, added: boolean) => Promise<void> | void },
) {
  const f = field(parent, label, key);
  f.addClass("is-wide");
  const chips = el(f, "div", "booker-chips");
  let items = rawList(ctx.fm[key]);
  let note: HTMLElement | null = null;
  const draw = () => {
    chips.empty();
    const asks: string[] = [];
    for (const raw of items) {
      const chip = el(chips, "span", "booker-chip booker-ins-chip");
      const ask = opts.hint?.(itemName(raw));
      if (ask) {
        chip.addClass("is-dup");
        chip.title = ask;
        asks.push(ask);
      }
      el(chip, "span", undefined, itemName(raw));
      const x = el(chip, "button", "booker-chip-x", "×");
      x.title = "Remove";
      x.setAttribute("aria-label", `Remove ${itemName(raw)}`);
      x.onclick = () => {
        void writeFm(ctx, (fm) => {
          items = removeFromList(fm[key], itemName(raw), opts.asLink);
          fm[key] = items;
        }).then(async () => {
          draw();
          await opts.after?.(itemName(raw), false);
        });
      };
    }
    if (note) {
      note.setText([...new Set(asks)].join(" "));
      note.style.display = asks.length ? "" : "none";
    }
  };
  draw();
  const row = el(f, "div", "booker-chip-add");
  const input = el(row, "input", "booker-input");
  input.type = "text";
  input.placeholder = opts.placeholder ?? "Add…";
  if (opts.suggestions) datalist(f, input, opts.suggestions);
  const err = el(f, "div", "booker-field-note booker-warn");
  err.style.display = "none";
  note = el(f, "div", "booker-field-note booker-dup-note");
  note.style.display = "none";
  draw();
  const add = () => {
    const name = opts.asLink ? cleanLinkName(input.value) : input.value.trim();
    if (!name) return;
    const problem = opts.validate ? opts.validate(name) : null;
    err.setText(problem ?? "");
    err.style.display = problem ? "" : "none";
    if (problem) return;
    input.value = "";
    void writeFm(ctx, (fm) => {
      items = addToList(fm[key], name, opts.asLink);
      fm[key] = items;
    }).then(async () => {
      draw();
      await opts.after?.(name, true);
    });
  };
  const btn = el(row, "button", "clickable-icon booker-chip-addbtn");
  setIcon(btn, "plus");
  btn.setAttr("aria-label", `Add to ${label.toLowerCase()}`);
  btn.onclick = add;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  });
  return f;
}
