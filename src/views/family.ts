import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type BookerPlugin from "../main";
import { openNoteIn } from "../openTarget";
import { linkList } from "../project/format";
import { layoutFamily, MAIN_TREE, parseFamily, type FamilyFile, type Person, type TreeDef } from "../project/family";
import { codexFiles, createCodex, findProjects, Project, readSystemJson, writeSystemJson } from "../project/vaultOps";
import { actionBtn, actionRow, ListPicker, NamePrompt, notifyError } from "../ui";

export const VIEW_FAMILY = "booker-family";
const FILE = "family-trees.json";
const NS = "http://www.w3.org/2000/svg";
const NODE_W = 132;
const NODE_H = 40;
const GAP_X = 28;
const GAP_Y = 64;
const PAD = 28;
const NEW = "\u0000new";

function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** A node map of the people in the story: parents above children, partners side by side, and everyone with no links set apart. */
export class FamilyView extends ItemView {
  private projectPath: string | null = null;
  private treeId = MAIN_TREE;
  private file: FamilyFile = { trees: [] };
  private people: Person[] = [];
  private files = new Map<string, TFile>();
  private holder!: HTMLElement;
  private bar!: HTMLElement;
  private saving = false;
  private reloadSoon = debounce(() => void this.loadTree(), 400, true);

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_FAMILY;
  }
  getDisplayText() {
    return "Family tree";
  }
  getIcon() {
    return "network";
  }
  getState() {
    return { project: this.projectPath, tree: this.treeId };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    if (typeof state?.tree === "string") this.treeId = state.tree;
    await super.setState(state, result);
    await this.loadTree();
  }

  async onOpen() {
    this.contentEl.addClass("booker-family", "booker-board");
    this.bar = this.contentEl.createDiv({ cls: "booker-family-bar" });
    this.holder = this.contentEl.createDiv({ cls: "booker-family-map" });
    const changed = (f: unknown) => {
      if (!(f instanceof TFile)) return;
      if (f.path.includes("/Characters/") || (f.name === FILE && !this.saving)) this.reloadSoon();
    };
    this.registerEvent(this.plugin.app.metadataCache.on("changed", changed));
    this.registerEvent(this.plugin.app.vault.on("create", changed));
    this.registerEvent(this.plugin.app.vault.on("delete", changed));
    this.registerEvent(this.plugin.app.vault.on("rename", changed));
    await this.loadTree();
  }

  private project(): Project | null {
    const all = findProjects(this.plugin.app);
    return all.find((p) => p.file.path === this.projectPath) ?? all[0] ?? null;
  }

  private async loadTree() {
    const proj = this.project();
    if (!this.holder) return;
    if (!proj) {
      this.bar.empty();
      this.holder.empty();
      this.holder.createEl("p", { cls: "booker-muted", text: "No project yet. Create one from the Booker hub." });
      return;
    }
    this.file = parseFamily(await readSystemJson(this.plugin.app, proj, FILE));
    this.files.clear();
    this.people = codexFiles(this.plugin.app, proj, "characters").map((f) => {
      this.files.set(f.basename, f);
      const fm = this.plugin.app.metadataCache.getFileCache(f)?.frontmatter;
      return { name: f.basename, parents: linkList(fm?.parents), partners: linkList(fm?.partners) };
    });
    if (this.treeId !== MAIN_TREE && !this.file.trees.some((t) => t.id === this.treeId)) this.treeId = MAIN_TREE;
    this.render(proj);
  }

  private tree(): TreeDef | null {
    return this.file.trees.find((t) => t.id === this.treeId) ?? null;
  }

  private async saveTrees(proj: Project) {
    this.saving = true;
    try {
      await writeSystemJson(this.plugin.app, proj, FILE, this.file);
    } catch (e) {
      notifyError(e, "save the family trees");
    } finally {
      window.setTimeout(() => (this.saving = false), 300);
    }
  }

  // ------------------------------------------------------------ editing links

  private async link(name: string, key: "parents" | "partners", other: string, add: boolean) {
    const f = this.files.get(name);
    if (!f) return;
    await this.plugin.app.fileManager.processFrontMatter(f, (fm) => {
      const cur: string[] = Array.isArray(fm[key]) ? fm[key].map(String) : fm[key] ? [String(fm[key])] : [];
      const rest = cur.filter((x) => linkList(x)[0] !== other);
      fm[key] = add ? [...rest, `[[${other}]]`] : rest;
    });
  }

  /** Pick an existing character, or make a new one, then hand back its name. */
  private pickPerson(proj: Project, heading: string, exclude: string[], then: (name: string) => Promise<void>) {
    const names = this.people.map((p) => p.name).filter((n) => !exclude.includes(n));
    new ListPicker<string>(this.plugin.app, [NEW, ...names], (n) => (n === NEW ? "+New character…" : n), heading, (n) => {
      if (n !== NEW) {
        void then(n).catch((e) => notifyError(e, "link these people"));
        return;
      }
      new NamePrompt(this.plugin.app, "New character", "", async (nm) => {
        try {
          const f = await createCodex(this.plugin.app, proj, "character", nm);
          this.files.set(f.basename, f);
          await then(f.basename);
          const t = this.tree();
          if (t && !t.members.includes(f.basename)) {
            t.members.push(f.basename);
            await this.saveTrees(proj);
          }
        } catch (e) {
          notifyError(e, "create the character");
        }
      }).open();
    }).open();
  }

  private personMenu(proj: Project, name: string, ev: MouseEvent | { x: number; y: number }) {
    const me = this.people.find((p) => p.name === name);
    const m = new Menu();
    m.addItem((i) => i.setTitle("Open character").setIcon("user").onClick(() => this.openPerson(name)));
    m.addSeparator();
    const after = (fn: () => Promise<void>) => () => void fn().then(() => this.loadTree()).catch((e) => notifyError(e, "link these people"));
    m.addItem((i) => i.setTitle("Add parent…").setIcon("arrow-up").onClick(() => this.pickPerson(proj, `Parent of ${name}`, [name], async (p) => after(() => this.link(name, "parents", p, true))())));
    m.addItem((i) => i.setTitle("Add partner…").setIcon("heart").onClick(() => this.pickPerson(proj, `Partner of ${name}`, [name], async (p) => after(async () => { await this.link(name, "partners", p, true); await this.link(p, "partners", name, true); })())));
    m.addItem((i) => i.setTitle("Add child…").setIcon("arrow-down").onClick(() => this.pickPerson(proj, `Child of ${name}`, [name], async (c) => after(() => this.link(c, "parents", name, true))())));
    const undo: Array<[string, () => Promise<void>]> = [];
    for (const p of me?.parents ?? []) undo.push([`Remove parent ${p}`, () => this.link(name, "parents", p, false)]);
    for (const p of me?.partners ?? []) undo.push([`Remove partner ${p}`, async () => { await this.link(name, "partners", p, false); await this.link(p, "partners", name, false); }]);
    for (const c of this.people.filter((p) => p.parents.includes(name))) undo.push([`Remove child ${c.name}`, () => this.link(c.name, "parents", name, false)]);
    if (undo.length) m.addSeparator();
    for (const [t, fn] of undo) m.addItem((i) => i.setTitle(t).setIcon("unlink").onClick(after(fn)));
    const tree = this.tree();
    if (tree) {
      m.addSeparator();
      m.addItem((i) => i.setTitle("Take out of this tree").setIcon("x").onClick(() => void (async () => {
        tree.members = tree.members.filter((x) => x !== name);
        await this.saveTrees(proj);
        this.render(proj);
      })()));
    }
    if (ev instanceof MouseEvent) m.showAtMouseEvent(ev);
    else m.showAtPosition(ev);
  }

  private openPerson(name: string) {
    const f = this.files.get(name);
    if (f) void openNoteIn(this.plugin, f, this.leaf);
  }

  // ---------------------------------------------------------------- drawing

  private render(proj: Project) {
    this.drawBar(proj);
    this.holder.empty();
    const tree = this.tree();
    const known = new Set(this.people.map((p) => p.name));
    const members = tree ? tree.members.filter((n) => known.has(n)) : undefined;
    const lay = layoutFamily(this.people, members);

    if (!this.people.length) {
      this.holder.createEl("p", { cls: "booker-muted", text: "No characters yet. Add some in the Codex, then link them here: use the ⋯ on a person to add parents, partners and children." });
      return;
    }
    if (tree && !tree.members.length) this.holder.createEl("p", { cls: "booker-muted", text: "This tree is empty. Use Add person to put characters in it." });

    const w = Math.max(lay.placed.length ? (lay.slots + 1) * (NODE_W + GAP_X) + PAD * 2 - GAP_X : 0, 0);
    const h = lay.placed.length ? lay.gens * (NODE_H + GAP_Y) + PAD * 2 - GAP_Y : 0;
    const pos = new Map(lay.placed.map((p) => [p.name, { x: PAD + p.slot * (NODE_W + GAP_X), y: PAD + p.gen * (NODE_H + GAP_Y) }]));
    if (lay.placed.length) {
      const wrap = this.holder.createDiv({ cls: "booker-family-scroll" });
      const root = svg(wrap as unknown as Element, "svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "booker-family-svg" });
      // partner lines, then descent from the middle of the parents (or the one parent)
      for (const [a, b] of lay.couples) {
        const A = pos.get(a)!, B = pos.get(b)!;
        svg(root, "line", { x1: A.x + NODE_W / 2, y1: A.y + NODE_H / 2, x2: B.x + NODE_W / 2, y2: B.y + NODE_H / 2, class: "booker-family-couple" });
      }
      const byChild = new Map<string, string[]>();
      for (const d of lay.descent) byChild.set(d.child, [...(byChild.get(d.child) ?? []), d.parent]);
      for (const [child, parents] of byChild) {
        const C = pos.get(child)!;
        const ps = parents.map((p) => pos.get(p)!);
        const together = ps.length === 2 && this.people.find((p) => p.name === parents[0])?.partners.includes(parents[1]) || ps.length === 2 && this.people.find((p) => p.name === parents[1])?.partners.includes(parents[0]);
        const anchors = together
          ? [{ x: (ps[0].x + ps[1].x) / 2 + NODE_W / 2, y: ps[0].y + NODE_H / 2 }]
          : ps.map((p) => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H }));
        for (const a of anchors) {
          const y1 = a.y, y2 = C.y, mid = (y1 + y2) / 2;
          svg(root, "path", { d: `M${a.x},${y1} C${a.x},${mid} ${C.x + NODE_W / 2},${mid} ${C.x + NODE_W / 2},${y2}`, class: "booker-family-descent" });
        }
      }
      for (const p of lay.placed) this.node(root, proj, p.name, pos.get(p.name)!.x, pos.get(p.name)!.y);
    }

    // everyone with no links
    const loose = this.holder.createDiv({ cls: "booker-family-loose" });
    loose.createEl("h4", { text: `Not connected yet (${lay.unconnected.length})` });
    if (!lay.unconnected.length) loose.createEl("p", { cls: "booker-muted", text: tree ? "Everyone in this tree is linked to someone." : "Everyone is linked to someone." });
    const row = loose.createDiv({ cls: "booker-family-chips" });
    for (const n of lay.unconnected) {
      const chip = row.createDiv({ cls: "booker-family-chip" });
      const a = chip.createEl("a", { text: n });
      a.onclick = () => this.openPerson(n);
      const more = chip.createEl("button", { cls: "booker-family-more", text: "⋯", attr: { "aria-label": `Link ${n}` } });
      more.onclick = (e) => this.personMenu(proj, n, e);
    }
  }

  private node(root: SVGElement, proj: Project, name: string, x: number, y: number) {
    const g = svg(root, "g", { class: "booker-family-node", transform: `translate(${x},${y})` });
    svg(g, "rect", { width: NODE_W, height: NODE_H, rx: 8, class: "booker-family-box" });
    const max = Math.floor((NODE_W - 30) / 6.8);
    svg(g, "text", { x: 10, y: NODE_H / 2 + 4.5, class: "booker-family-name" }, name.length > max ? name.slice(0, max - 1) + "…" : name);
    svg(g, "title", {}, name);
    const more = svg(g, "g", { class: "booker-family-more-svg" });
    svg(more, "circle", { cx: NODE_W - 13, cy: NODE_H / 2, r: 9 });
    svg(more, "text", { x: NODE_W - 13, y: NODE_H / 2 + 4, "text-anchor": "middle" }, "⋯");
    (g as unknown as HTMLElement).addEventListener("click", () => this.openPerson(name));
    (more as unknown as HTMLElement).addEventListener("click", (e) => {
      e.stopPropagation();
      this.personMenu(proj, name, e as MouseEvent);
    });
    (g as unknown as HTMLElement).addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.personMenu(proj, name, e as MouseEvent);
    });
  }

  private drawBar(proj: Project) {
    this.bar.empty();
    const sel = this.bar.createEl("select", { cls: "dropdown booker-family-select" });
    sel.createEl("option", { text: "Main family", value: MAIN_TREE });
    for (const t of this.file.trees) sel.createEl("option", { text: t.name, value: t.id });
    sel.value = this.treeId;
    sel.onchange = () => {
      this.treeId = sel.value;
      this.render(proj);
    };
    const row = actionRow(this.bar);
    actionBtn(row, "New tree", "plus", () => {
      new NamePrompt(this.plugin.app, "New family tree", "A separate tree, such as a royal house or a second family. Pick who is in it afterwards.", async (name) => {
        const id = `t${Date.now().toString(36)}`;
        this.file.trees.push({ id, name: name.trim() || "Family", members: [] });
        this.treeId = id;
        await this.saveTrees(proj);
        this.render(proj);
      }).open();
    }, { cta: true, tip: "Make another family tree" });
    const tree = this.tree();
    if (tree) {
      actionBtn(row, "Add person", "user-plus", () => {
        const left = this.people.map((p) => p.name).filter((n) => !tree.members.includes(n));
        if (!left.length) return void new Notice("Booker: everyone is already in this tree.");
        new ListPicker<string>(this.plugin.app, left, (n) => n, "Add to this tree", async (n) => {
          // bring close relatives along so the tree is not just loose names
          tree.members.push(n);
          await this.saveTrees(proj);
          this.render(proj);
        }).open();
      }, { tip: "Put a character in this tree" });
      actionBtn(row, "Rename", "pencil", () => {
        new NamePrompt(this.plugin.app, "Rename tree", "", async (name) => {
          if (!name.trim()) return;
          tree.name = name.trim();
          await this.saveTrees(proj);
          this.render(proj);
        }, tree.name, false, "Rename").open();
      }, { tip: "Rename this tree" });
      actionBtn(row, "Delete", "trash-2", () => {
        this.file.trees = this.file.trees.filter((t) => t.id !== tree.id);
        this.treeId = MAIN_TREE;
        void this.saveTrees(proj).then(() => this.render(proj));
      }, { tip: "Delete this tree (the characters stay)" });
    }
  }
}
