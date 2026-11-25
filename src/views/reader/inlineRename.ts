/** Double-click a title to rename it where it stands: Enter or leaving the box saves, Escape keeps the old name. */
export function renameInline(el: HTMLElement, current: () => string, save: (name: string) => Promise<void>) {
  el.setAttr("title", "Double-click to rename");
  el.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    if (el.querySelector("input")) return;
    const old = current();
    const keep = el.textContent ?? old;
    el.empty();
    const input = el.createEl("input", { type: "text", cls: "booker-inline-rename", value: old });
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (commit && name && name !== old) {
        try {
          await save(name);
          el.setText(name);
          return;
        } catch {
          /* the old name stays */
        }
      }
      el.setText(commit && name ? name : keep);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void finish(true);
      else if (e.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(true));
    input.addEventListener("dblclick", (e) => e.stopPropagation());
    input.focus();
    input.select();
  });
}
