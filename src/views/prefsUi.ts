/**
 * Small building blocks for preference panels in the Apple style: inset grouped lists with a quiet caption, a label on the left and
 * its control on the right, hairline separators, segmented controls. Plain DOM, no Obsidian `Setting`, so they look the same everywhere
 * and can be tested.
 */

export interface PrefRow {
  el: HTMLElement;
  ctrl: HTMLElement;
}

/** An inset group with an optional small uppercase caption above it and a footnote below. */
export function group(parent: HTMLElement, caption?: string, note?: string): HTMLElement {
  if (caption) parent.createDiv({ cls: "bp-caption", text: caption });
  const g = parent.createDiv({ cls: "bp-group" });
  if (note) parent.createDiv({ cls: "bp-note", text: note });
  return g;
}

/** Put a footnote under the group that was just made. */
export function footnote(parent: HTMLElement, text: string): HTMLElement {
  return parent.createDiv({ cls: "bp-note", text });
}

export function row(g: HTMLElement, label: string, desc?: string): PrefRow {
  const el = g.createDiv({ cls: "bp-row" });
  const l = el.createDiv({ cls: "bp-label" });
  l.createDiv({ cls: "bp-title", text: label });
  if (desc) l.createDiv({ cls: "bp-desc", text: desc });
  return { el, ctrl: el.createDiv({ cls: "bp-ctrl" }) };
}

export function toggleRow(g: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void, desc?: string): PrefRow {
  const r = row(g, label, desc);
  const t = r.ctrl.createEl("button", { cls: "bp-toggle", attr: { role: "switch", "aria-checked": String(value), "aria-label": label } });
  t.toggleClass("is-on", value);
  t.onclick = () => {
    const v = t.getAttr("aria-checked") !== "true";
    t.setAttr("aria-checked", String(v));
    t.toggleClass("is-on", v);
    onChange(v);
  };
  return r;
}

/** A text field that reports on Enter or when it loses focus (not on every key), so half-typed numbers are never saved. */
export function textRow(g: HTMLElement, label: string, value: string, onCommit: (v: string) => string | void, opts: { placeholder?: string; desc?: string; width?: number; align?: "left" | "right" } = {}): PrefRow {
  const r = row(g, label, opts.desc);
  const i = r.ctrl.createEl("input", { cls: "bp-input", attr: { type: "text", placeholder: opts.placeholder ?? "", "aria-label": label } });
  i.value = value;
  if (opts.width) i.style.width = `${opts.width}px`;
  if (opts.align === "left") i.style.textAlign = "left";
  i.addEventListener("change", () => {
    const back = onCommit(i.value);
    if (typeof back === "string") i.value = back;
  });
  i.addEventListener("keydown", (e) => {
    if (e.key === "Enter") i.blur();
  });
  return r;
}

/** Two small fields in one row, such as the left and right edge of a map. */
export function pairRow(g: HTMLElement, label: string, a: string, b: string, onCommit: (a: string, b: string) => [string, string] | void, desc?: string): PrefRow {
  const r = row(g, label, desc);
  const mk = (v: string, aria: string) => {
    const i = r.ctrl.createEl("input", { cls: "bp-input is-pair", attr: { type: "text", "aria-label": `${label}, ${aria}` } });
    i.value = v;
    return i;
  };
  r.ctrl.createSpan({ cls: "bp-dash", text: "" });
  const ia = mk(a, "from");
  r.ctrl.createSpan({ cls: "bp-dash", text: "to" });
  const ib = mk(b, "to");
  const go = () => {
    const back = onCommit(ia.value, ib.value);
    if (back) {
      ia.value = back[0];
      ib.value = back[1];
    }
  };
  for (const i of [ia, ib]) {
    i.addEventListener("change", go);
    i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") i.blur();
    });
  }
  return r;
}

export function selectRow(g: HTMLElement, label: string, options: Array<[string, string]>, value: string, onChange: (v: string) => void, desc?: string): PrefRow {
  const r = row(g, label, desc);
  const s = r.ctrl.createEl("select", { cls: "dropdown bp-select", attr: { "aria-label": label } });
  for (const [v, t] of options) {
    const o = s.createEl("option", { text: t });
    o.value = v;
    if (v === value) o.selected = true;
  }
  s.onchange = () => onChange(s.value);
  return r;
}

export function sliderRow(g: HTMLElement, label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, desc?: string): PrefRow {
  const r = row(g, label, desc);
  const out = r.ctrl.createSpan({ cls: "bp-value", text: `${Math.round(value * 100)}%` });
  const s = r.ctrl.createEl("input", { cls: "bp-slider", attr: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label } });
  s.value = String(value);
  s.oninput = () => {
    out.setText(`${Math.round(Number(s.value) * 100)}%`);
    onInput(Number(s.value));
  };
  return r;
}

export function colorRow(g: HTMLElement, label: string, value: string, onInput: (v: string) => void, desc?: string): PrefRow {
  const r = row(g, label, desc);
  const c = r.ctrl.createEl("input", { cls: "bp-color", attr: { type: "color", "aria-label": label } });
  c.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#888888";
  c.oninput = () => onInput(c.value);
  return r;
}

export interface PrefButton {
  text: string;
  onClick: (ev: MouseEvent) => void;
  warn?: boolean;
  cta?: boolean;
  disabled?: boolean;
}

export function buttonRow(g: HTMLElement, label: string, buttons: PrefButton[], desc?: string): PrefRow {
  const r = row(g, label, desc);
  for (const b of buttons) {
    const e = r.ctrl.createEl("button", { cls: "bp-button" + (b.warn ? " is-warn" : "") + (b.cta ? " is-cta" : ""), text: b.text });
    e.disabled = !!b.disabled;
    e.onclick = b.onClick;
  }
  return r;
}

export interface Segment {
  id: string;
  label: string;
  /** a small second line or badge */
  meta?: string;
  off?: boolean;
}

/** A row of chips (the map switcher, the engine choice): one is selected; the last can be an "add" action. */
export function segmented(parent: HTMLElement, items: Segment[], value: string, onPick: (id: string) => void, onMenu?: (id: string, ev: MouseEvent) => void): HTMLElement {
  const bar = parent.createDiv({ cls: "bp-seg", attr: { role: "tablist" } });
  for (const it of items) {
    const b = bar.createEl("button", { cls: "bp-seg-item", attr: { role: "tab", "aria-selected": String(it.id === value) } });
    b.toggleClass("is-on", it.id === value);
    b.toggleClass("is-off", !!it.off);
    b.createSpan({ text: it.label });
    if (it.meta) b.createSpan({ cls: "bp-seg-meta", text: it.meta });
    b.onclick = () => onPick(it.id);
    if (onMenu) b.addEventListener("contextmenu", (ev) => (ev.preventDefault(), onMenu(it.id, ev)));
  }
  return bar;
}
