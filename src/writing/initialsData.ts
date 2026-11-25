// Fonts for the chapter opening: IM Fell Double Pica (Igino Marini), Jacquard 24 (The Soft Type Project) and Cinzel Decorative (Natanael Gama),
// all under the SIL Open Font License 1.1, unmodified. The licences are in assets/fonts/initials/.
import fell from "../../assets/fonts/initials/IMFELLDoublePica-Regular.ttf";
import jacquard from "../../assets/fonts/initials/Jacquard24-Regular.ttf";
import cinzel from "../../assets/fonts/initials/CinzelDecorative-Bold.ttf";
import A from "../../assets/initials/illuminated/A.png";
import B from "../../assets/initials/illuminated/B.png";
import C from "../../assets/initials/illuminated/C.png";
import D from "../../assets/initials/illuminated/D.png";
import E from "../../assets/initials/illuminated/E.png";
import F from "../../assets/initials/illuminated/F.png";
import G from "../../assets/initials/illuminated/G.png";
import H from "../../assets/initials/illuminated/H.png";
import I from "../../assets/initials/illuminated/I.png";
import J from "../../assets/initials/illuminated/J.png";
import K from "../../assets/initials/illuminated/K.png";
import L from "../../assets/initials/illuminated/L.png";
import M from "../../assets/initials/illuminated/M.png";
import N from "../../assets/initials/illuminated/N.png";
import O from "../../assets/initials/illuminated/O.png";
import P from "../../assets/initials/illuminated/P.png";
import Q from "../../assets/initials/illuminated/Q.png";
import R from "../../assets/initials/illuminated/R.png";
import S from "../../assets/initials/illuminated/S.png";
import T from "../../assets/initials/illuminated/T.png";
import U from "../../assets/initials/illuminated/U.png";
import V from "../../assets/initials/illuminated/V.png";
import W from "../../assets/initials/illuminated/W.png";
import X from "../../assets/initials/illuminated/X.png";
import Y from "../../assets/initials/illuminated/Y.png";
import Z from "../../assets/initials/illuminated/Z.png";

export const OPENING_FONT_FILES = {
  fell: { name: "IMFELLDoublePica-Regular.ttf", data: fell, weight: "normal" },
  jacquard: { name: "Jacquard24-Regular.ttf", data: jacquard, weight: "normal" },
  cinzel: { name: "CinzelDecorative-Bold.ttf", data: cinzel, weight: "bold" },
} as const;

/** The illuminated letters A to Z as PNG bytes (black on transparent). */
export const ILLUMINATED: Record<string, Uint8Array> = { A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z };
