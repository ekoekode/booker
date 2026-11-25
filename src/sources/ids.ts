const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A sortable unique id (ULID layout: time, then random). */
export function uid(now = Date.now(), rnd: () => number = Math.random): string {
  let t = "";
  let n = now;
  for (let i = 0; i < 10; i++) {
    t = B32[n % 32] + t;
    n = Math.floor(n / 32);
  }
  let r = "";
  for (let i = 0; i < 16; i++) r += B32[Math.floor(rnd() * 32)];
  return t + r;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

export function lastName(author: string): string {
  const a = author.trim();
  if (a.includes(",")) return a.split(",")[0].trim();
  const parts = a.split(/\s+/);
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
  while (parts.length > 1 && suffix.test(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] ?? "";
}

/** "calvin1559", then "calvin1559b" if taken. */
export function citekey(authors: string[], title: string, year: string | undefined, taken: Set<string>): string {
  const who = authors[0] ? lastName(authors[0]) : title.split(/\s+/)[0] ?? "source";
  const base = fold(who).toLowerCase().replace(/[^a-z0-9]/g, "") + (year ?? "").replace(/\D/g, "").slice(0, 4);
  const root = base || "source";
  if (!taken.has(root)) return root;
  for (const s of "bcdefghijklmnopqrstuvwxyz") if (!taken.has(root + s)) return root + s;
  return root + uid().slice(-4).toLowerCase();
}

export const safeFolderName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Source";
