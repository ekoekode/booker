// Literata (SIL Open Font License 1.1), subset to Latin. See assets/fonts/OFL.txt.
import regular from "../../assets/fonts/Literata-Regular.ttf";
import italic from "../../assets/fonts/Literata-Italic.ttf";
import bold from "../../assets/fonts/Literata-Bold.ttf";
import boldItalic from "../../assets/fonts/Literata-BoldItalic.ttf";
// Noto Serif Hebrew (SIL Open Font License 1.1), the Hebrew block only. See assets/fonts/OFL-NotoSerifHebrew.txt.
import hebrew from "../../assets/fonts/NotoSerifHebrew-Regular.woff";

export const HEBREW_FONT = hebrew;

export const FONT_FILES = [
  { name: "Literata-Regular.ttf", data: regular },
  { name: "Literata-Italic.ttf", data: italic },
  { name: "Literata-Bold.ttf", data: bold },
  { name: "Literata-BoldItalic.ttf", data: boldItalic },
];

export const FONTS = { regular, italic, bold, boldItalic };
