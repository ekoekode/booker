import { joinPieces } from "./toMarkdown";

/** Rich Text Format turned into Markdown. RTF has no real heading styles, so a short paragraph set larger than the body text (or a short line that is all bold) becomes a heading. */

interface St {
  b: boolean;
  i: boolean;
  fs: number;
  skip: boolean;
  uc: number;
}

const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "footnote", "themedata", "colorschememapping", "latentstyles", "datastore", "listtable", "listoverridetable", "rsidtbl", "generator", "fldinst", "object", "xmlnstbl", "mmathPr"]);
const SYMBOL: Record<string, string> = { emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", bullet: "•", tab: " ", line: "\n", emspace: " ", enspace: " ", ltrmark: "", rtlmark: "", zwj: "", zwnj: "" };
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

interface Para {
  pieces: { text: string; b?: boolean; i?: boolean }[];
  size: number;
  chars: number;
  allBold: boolean;
}

export function rtfToMarkdown(rtf: string): string {
  if (!/^\s*\{\\rtf/.test(rtf)) throw new Error("This is not an RTF file.");
  const paras: Para[] = [];
  let cur: Para = { pieces: [], size: 0, chars: 0, allBold: true };
  const stack: St[] = [];
  let st: St = { b: false, i: false, fs: 24, skip: false, uc: 1 };
  let skipChars = 0;
  const put = (text: string) => {
    if (st.skip || !text) return;
    if (skipChars) {
      const n = Math.min(skipChars, text.length);
      skipChars -= n;
      text = text.slice(n);
      if (!text) return;
    }
    cur.pieces.push({ text, b: st.b, i: st.i });
    if (text.trim()) {
      cur.chars += text.length;
      cur.size = Math.max(cur.size, st.fs);
      if (!st.b) cur.allBold = false;
    }
  };
  const endPara = () => {
    paras.push(cur);
    cur = { pieces: [], size: 0, chars: 0, allBold: true };
  };
  let i = 0;
  const n = rtf.length;
  while (i < n) {
    const c = rtf[i];
    if (c === "{") {
      stack.push({ ...st });
      i++;
    } else if (c === "}") {
      st = stack.pop() ?? st;
      i++;
    } else if (c === "\\") {
      const d = rtf[i + 1];
      if (d === "*") {
        // an optional destination: ignore the whole group
        st.skip = true;
        i += 2;
      } else if (d === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (Number.isFinite(code)) put(code >= 0x80 && code < 0xa0 ? CP1252[code - 0x80] : String.fromCharCode(code));
        i += 4;
      } else if (d === "\\" || d === "{" || d === "}") {
        put(d);
        i += 2;
      } else if (d === "~") {
        put(" ");
        i += 2;
      } else if (d === "-" || d === "_" || d === "|" || d === ":") {
        if (d === "_") put("‑");
        i += 2;
      } else if (d === "\n" || d === "\r") {
        endPara();
        i += 2;
      } else {
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
        if (!m) {
          i += 2;
          continue;
        }
        i += m[0].length;
        const w = m[1];
        const v = m[2] === undefined ? undefined : parseInt(m[2], 10);
        if (SKIP.has(w)) st.skip = true;
        else if (w === "par" || w === "sect" || w === "page") {
          if (!st.skip) endPara();
        } else if (w === "pard") cur.allBold = cur.allBold;
        else if (w === "b") st.b = v !== 0;
        else if (w === "i") st.i = v !== 0;
        else if (w === "fs" && v) st.fs = v;
        else if (w === "uc" && v !== undefined) st.uc = v;
        else if (w === "u" && v !== undefined) {
          put(String.fromCodePoint(v < 0 ? v + 65536 : v));
          skipChars = st.uc;
        } else if (w in SYMBOL) put(SYMBOL[w]);
      }
    } else if (c === "\r" || c === "\n") {
      i++;
    } else {
      let j = i;
      while (j < n && !"{}\\\r\n".includes(rtf[j])) j++;
      put(rtf.slice(i, j));
      i = j;
    }
  }
  if (cur.pieces.length) endPara();

  const body = (() => {
    const bySize = new Map<number, number>();
    for (const p of paras) if (p.chars) bySize.set(p.size, (bySize.get(p.size) ?? 0) + p.chars);
    return [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 24;
  })();
  // sizes clearly above the body text, largest first: the largest is a level 1 heading, the rest level 2
  const big = [...new Set(paras.filter((p) => p.chars && p.size >= body * 1.15).map((p) => p.size))].sort((a, b) => b - a);
  const out: string[] = [];
  for (const p of paras) {
    const text = joinPieces(p.pieces.map((x) => ({ ...x, b: x.b && !p.allBold ? x.b : false, i: x.i }))).replace(/[ \t]+\n/g, "\n").trim();
    const plain = p.pieces.map((x) => x.text).join("").trim();
    if (!plain) continue;
    const short = plain.length <= 80 && !/[.!?:;,]$/.test(plain);
    if (short && big.includes(p.size)) out.push(`${big.length > 1 && p.size === big[0] ? "#" : big.length > 1 ? "##" : "#"} ${plain}`);
    else if (short && p.allBold && p.size >= body) out.push(`## ${plain}`);
    else out.push(text);
  }
  return out.join("\n\n");
}
