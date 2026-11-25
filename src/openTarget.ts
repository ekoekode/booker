import type { TFile, Workspace, WorkspaceLeaf } from "obsidian";
import type BookerPlugin from "./main";

export const OPEN_IN_MODES = ["first", "auto", "same", "left", "right", "top"] as const;
export type OpenIn = (typeof OPEN_IN_MODES)[number];

export const OPEN_IN_LABELS: Record<OpenIn, string> = {
  first: "The left pane (recommended)",
  auto: "Auto (keep Booker visible)",
  same: "Same pane",
  left: "Pane to the left",
  right: "Pane to the right",
  top: "Pane above",
};

export const VIEWS_IN_MODES = ["auto", "right", "tab"] as const;
export type ViewsIn = (typeof VIEWS_IN_MODES)[number];

export const VIEWS_IN_LABELS: Record<ViewsIn, string> = {
  auto: "Auto: the right pane, a split when the window is wide, else a tab",
  right: "Always the right pane (split if needed)",
  tab: "A new tab in the current pane",
};

export interface PaneInfo {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** already shows a note, so it is the natural place to write */
  isNote: boolean;
}

export type OpenPlan = { reuse: string } | { split: { anchor: string; direction: "vertical" | "horizontal"; before: boolean } };

const cx = (p: PaneInfo) => p.x + p.w / 2;
const cy = (p: PaneInfo) => p.y + p.h / 2;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 1;

/**
 * Decide where a note opens. `origin` is the pane the user clicked in (where Booker sits);
 * `panes` lists every pane in the main area, most recently used first.
 * auto: with another pane open, use it (so Booker stays visible); with one pane, split to the right.
 */
export function planOpen(mode: OpenIn, origin: string, panes: PaneInfo[]): OpenPlan {
  if (mode === "first") {
    const left = panes.slice().sort((a, b) => a.x - b.x || a.y - b.y)[0];
    return left ? { reuse: left.id } : { reuse: origin };
  }
  const me = panes.find((p) => p.id === origin);
  if (!me || mode === "same") return { reuse: origin };
  const others = panes.filter((p) => p.id !== origin);
  const nearest = (cands: PaneInfo[], d: (p: PaneInfo) => number) => cands.sort((a, b) => d(a) - d(b))[0];

  if (mode === "auto") {
    const pick = others.find((p) => p.isNote) ?? others[0];
    return pick ? { reuse: pick.id } : { split: { anchor: origin, direction: "vertical", before: false } };
  }
  if (mode === "right" || mode === "left") {
    const right = mode === "right";
    const c = others.filter((p) => (right ? cx(p) > cx(me) : cx(p) < cx(me)) && overlap(p.y, p.y + p.h, me.y, me.y + me.h));
    const hit = nearest(c, (p) => Math.abs(cx(p) - cx(me)));
    return hit ? { reuse: hit.id } : { split: { anchor: origin, direction: "vertical", before: !right } };
  }
  const c = others.filter((p) => cy(p) < cy(me) && overlap(p.x, p.x + p.w, me.x, me.x + me.w));
  const hit = nearest(c, (p) => Math.abs(cy(p) - cy(me)));
  return hit ? { reuse: hit.id } : { split: { anchor: origin, direction: "horizontal", before: true } };
}

/** Open a note where the user's "Open chapters in" setting says. `from` is the view that asked (defaults to the most recent pane). */
export async function openNoteIn(plugin: BookerPlugin, file: TFile, from?: WorkspaceLeaf | null) {
  const ws = plugin.app.workspace;
  const { leaves, panes, infos, origin } = gatherPanes(ws, from);
  if (!origin) {
    await ws.getLeaf("tab").openFile(file);
    return;
  }
  const ids = infos.map((i) => i.id);
  const originId = ids[panes.findIndex((g) => g.parent === origin.parent)] ?? "0";

  const plan = planOpen(plugin.settings.openChaptersIn, originId, infos);
  let target: WorkspaceLeaf;
  if ("reuse" in plan) {
    // "same" opens in the leaf that asked; another pane opens in the tab it is showing
    const g = panes[Number(plan.reuse)];
    if (plugin.settings.openChaptersIn === "first") {
      // write in a note tab of the left pane; if it only holds charts, add a tab rather than replace one
      target = g.tabs.find((t) => t.view.getViewType() === "markdown" && t === g.shown) ?? g.tabs.find((t) => t.view.getViewType() === "markdown") ?? (g.shown.view.getViewType() === "empty" ? g.shown : tabIn(ws, g.shown));
    } else target = plan.reuse === originId ? origin : g.shown;
  } else {
    target = ws.createLeafBySplit(origin, plan.split.direction, plan.split.before);
  }
  await target.openFile(file);
  ws.setActiveLeaf(target, { focus: true });
}

export type ViewPlan = { tab: string } | { split: { anchor: string } };

/**
 * Where a chart, stats page or other view opens. `panes` are the panes of the main area, most recently used first;
 * `areaWidth` is the width of that area. Auto: with two or more panes use the rightmost one (as a new tab);
 * with one pane, split to its right when the area is wide, otherwise add a tab to it.
 */
export function planView(mode: ViewsIn, panes: PaneInfo[], areaWidth: number, wideAt: number): ViewPlan | null {
  if (!panes.length) return null;
  const rightmost = panes.slice().sort((a, b) => b.x - a.x || a.y - b.y)[0];
  if (mode === "tab") return { tab: panes[0].id };
  if (panes.length > 1) return { tab: rightmost.id };
  if (mode === "right" || areaWidth >= wideAt) return { split: { anchor: rightmost.id } };
  return { tab: rightmost.id };
}

/** A new tab in the same pane as `leaf`. */
function tabIn(ws: Workspace, leaf: WorkspaceLeaf): WorkspaceLeaf {
  ws.setActiveLeaf(leaf, { focus: false });
  return ws.getLeaf("tab");
}

function gatherPanes(ws: Workspace, origin?: WorkspaceLeaf | null) {
  const leaves: WorkspaceLeaf[] = [];
  ws.iterateRootLeaves((l) => void leaves.push(l));
  const recent = (l: WorkspaceLeaf) => (l as any).activeTime ?? 0;
  // A pane is a tab group, not a tab: tabs next to each other are the same pane.
  const groups = new Map<unknown, WorkspaceLeaf[]>();
  for (const l of leaves) groups.set(l.parent, [...(groups.get(l.parent) ?? []), l]);
  const panes = [...groups.entries()]
    .map(([parent, tabs]) => {
      const shown = tabs.find((t) => (t as any).tabHeaderEl?.classList.contains("is-active")) ?? tabs.slice().sort((a, b) => recent(b) - recent(a))[0];
      return { parent, tabs, shown, last: Math.max(...tabs.map(recent)) };
    })
    .sort((a, b) => b.last - a.last);
  const infos: PaneInfo[] = panes.map((g, i) => {
    const r = ((g.parent as any)?.containerEl ?? g.shown.view.containerEl).getBoundingClientRect();
    return { id: String(i), x: r.x, y: r.y, w: r.width, h: r.height, isNote: g.shown.view.getViewType() === "markdown" };
  });
  return { leaves, panes, infos, origin: origin && leaves.includes(origin) ? origin : ws.getMostRecentLeaf() ?? leaves[0] };
}

/** A leaf for a new Booker view, placed by the "Open charts and views in" setting. */
export function leafForView(plugin: BookerPlugin): WorkspaceLeaf {
  const ws = plugin.app.workspace;
  const { panes, infos } = gatherPanes(ws);
  const width = (ws.rootSplit as any)?.containerEl?.getBoundingClientRect?.().width ?? 0;
  const plan = planView(plugin.settings.openViewsIn, infos, width, plugin.settings.wideAt);
  if (!plan) return ws.getLeaf("tab");
  if ("tab" in plan) {
    return tabIn(ws, panes[Number(plan.tab)].shown);
  }
  return ws.createLeafBySplit(panes[Number(plan.split.anchor)].shown, "vertical", false);
}
