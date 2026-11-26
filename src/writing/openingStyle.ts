import { ILLUMINATED, OPENING_FONT_FILES } from "./initialsData";
import { isFontStyle, OPENING_FONT_FAMILY, resolveOpening, type Opening } from "./initials";

const loaded = new Set<string>();

/** Make one of the bundled opening fonts available to the editor. */
function loadFont(style: "fell" | "jacquard" | "cinzel") {
  if (loaded.has(style) || typeof FontFace === "undefined") return;
  loaded.add(style);
  const f = OPENING_FONT_FILES[style];
  const face = new FontFace(OPENING_FONT_FAMILY[style], new Uint8Array(f.data).buffer, { weight: f.weight });
  void face.load().then(() => (document.fonts as unknown as { add(f: FontFace): void }).add(face)).catch(() => undefined);
}

let artSheet: HTMLStyleElement | null = null;

/** One rule per letter, with the picture inside the stylesheet, so the editor needs no files. Made once, when the artwork is first chosen. */
function loadArt() {
  if (artSheet || typeof document === "undefined") return;
  const toData = (b: Uint8Array) => {
    let bin = "";
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
  };
  artSheet = document.createElement("style");
  artSheet.id = "booker-initials-art";
  artSheet.textContent = Object.entries(ILLUMINATED).map(([ch, data]) => `.booker-open-art .cm-line.nv-first[data-ini="${ch}"]::first-letter { --ini-img: url("${toData(data)}"); }`).join("\n");
  document.head.appendChild(artSheet);
}

/** The classes and variables that give one editor its chapter opening letter. Nothing when it is off, so no frame or size is left behind. */
export function openingAttrs(o: Partial<Opening> | undefined): { class: string; style: string } {
  const op = resolveOpening(o);
  if (op.style === "off") return { class: "", style: "" };
  const cls = ["booker-open", `booker-open-${op.style}`];
  let style = `--ini-lines:${op.lines};`;
  if (isFontStyle(op.style)) {
    loadFont(op.style);
    cls.push(`booker-frame-${op.frame}`);
    style += `--ini-font:"${OPENING_FONT_FAMILY[op.style]}";`;
  } else loadArt();
  return { class: cls.join(" "), style };
}
