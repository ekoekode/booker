import { Notice } from "obsidian";
import type BookerPlugin from "../main";
import { checkProjectFormat, fixProjectFormat, type Project } from "../project/vaultOps";
import { ConfirmModal, notifyError } from "../ui";

/** Bring a book up to this Booker's format: back it up first (nothing changes if the backup fails), then repair and stamp it. */
export function offerFormatFix(plugin: BookerPlugin, proj: Project, done: () => void) {
  const report = checkProjectFormat(plugin.app, proj);
  if (report.state === "newer") return void new Notice("Booker: this book was saved by a newer Booker. Update Booker before changing it.");
  const list = report.problems.map((p) => `• ${p.message}`).join("\n");
  new ConfirmModal(
    plugin.app,
    `Update “${proj.name}”?`,
    `Booker makes a full backup first, then repairs the book:\n${list}\n\nEmpty chapters and acts with no files are forgotten.`,
    "Back up and update",
    () =>
      void (async () => {
        const note = await plugin.backupNow(proj, true);
        if (note === null) return void new Notice("Booker: the backup could not be made, so the book was not changed. Check the backup folder in Project settings.", 10000);
        try {
          const did = await fixProjectFormat(plugin.app, proj);
          new Notice(`Booker: ${proj.name} updated: ${did.join(", ")}.`, 8000);
          done();
        } catch (e) {
          notifyError(e, "update the book");
        }
      })()
  ).open();
}

/** A banner for a book that does not match this Booker's format; returns false (and draws nothing) when it does. */
export function drawFormatBanner(parent: HTMLElement, plugin: BookerPlugin, proj: Project, done: () => void): boolean {
  const r = checkProjectFormat(plugin.app, proj);
  if (r.state === "ok") return false;
  const box = parent.createDiv({ cls: "booker-format-banner" });
  if (r.state === "newer") {
    box.createSpan({ text: `“${proj.name}” was saved by a newer Booker (format ${r.stored}; this one uses ${r.current}). Update Booker. Nothing will be changed in the book.` });
    return true;
  }
  box.createSpan({ text: `“${proj.name}” was saved in an older format (${r.stored}, now ${r.current}). ${r.problems.length} thing${r.problems.length === 1 ? "" : "s"} to fix.` });
  const b = box.createEl("button", { cls: "mod-cta", text: "Review and fix" });
  b.addEventListener("click", () => offerFormatFix(plugin, proj, done));
  return true;
}
