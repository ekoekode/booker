/** Moving a project folder to another place in the vault. Pure rules; the move itself is vaultOps.moveProject. */
export type MovePlan = { to: string } | { error: string };

const trim = (p: string) => p.replace(/^\/+|\/+$/g, "");

/** Where `base` ends up when it is put inside `parent` ("" or "/" is the vault root). */
export function planMove(base: string, parent: string): MovePlan {
  const from = trim(base);
  const into = trim(parent);
  const name = from.split("/").pop() ?? from;
  const to = into ? `${into}/${name}` : name;
  if (to === from) return { error: "The project is already there." };
  if (into === from || into.startsWith(from + "/")) return { error: "A project cannot be moved into itself." };
  return { to };
}
