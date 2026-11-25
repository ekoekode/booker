/**
 * Where the Church Fathers appear in the standard English sets: Ante-Nicene Fathers (ANF 1 to 10), Nicene and
 * Post-Nicene Fathers series 1 (NPNF1, 1 to 14) and series 2 (NPNF2, 1 to 14). Keyed by the author as the writings
 * database names them. This is by author, not by individual work, and is a guide to the printed volumes rather than
 * a catalogue: authors in no set are simply left out. Pure.
 */
export type Series = "ANF" | "NPNF1" | "NPNF2";

export interface Volume {
  series: Series;
  n: number;
}

const A = (...n: number[]): Volume[] => n.map((v) => ({ series: "ANF", n: v }));
const P1 = (...n: number[]): Volume[] => n.map((v) => ({ series: "NPNF1", n: v }));
const P2 = (...n: number[]): Volume[] => n.map((v) => ({ series: "NPNF2", n: v }));

const TABLE: Record<string, Volume[]> = {
  "Clement of Rome": A(1),
  "Ignatius of Antioch": A(1),
  "Polycarp of Smyrna": A(1),
  "Didache": A(7),
  "Epistle of Barnabas": A(1),
  "Papias of Hierapolis": A(1),
  "Epistle to Diognetus": A(1),
  "Shepherd of Hermas": A(2),
  "Justin Martyr": A(1),
  "Irenaeus": A(1),
  "Tatian the Assyrian": A(2),
  "Theophilus of Antioch": A(2),
  "Athenagoras of Athens": A(2),
  "Clement of Alexandria": A(2),
  "Aristides the Philosopher": A(9),
  "Hegesippus": A(8),
  "Melito of Sardis": A(8),
  "Tertullian": A(3, 4),
  "Marcus Minucius Felix": A(4),
  "Commodian": A(4),
  "Origen of Alexandria": A(4, 9),
  "Hippolytus of Rome": A(5),
  "Cyprian": A(5),
  "Caius Presbyter of Rome": A(5),
  "Novatian": A(5),
  "Gregory of Neocaesarea": A(6),
  "Dionysius of Alexandria": A(6),
  "Julius Africanus": A(6),
  "Methodius of Olympus": A(6),
  "Arnobius of Sicca": A(6),
  "Lucius Caecilius Firmianus Lactantius": A(7),
  "Victorinus of Pettau": A(7),
  "Theonas of Alexandria": A(6),
  "Peter of Alexandria": A(6),
  "Alexander of Alexandria": A(6),
  "Theognostus Of Alexandria": A(6),
  "Malchion": A(6),
  "Archelaus of Carrhae": A(6),
  "Pamphilus of Caesarea": A(6),
  "Apostolic Constitutions": A(7),
  "Liturgy of Saint Mark": A(7),
  "Liturgy of Saint James": A(7),
  "Protoevangelium of James": A(8),
  "Testaments of the Twelve Patriarchs": A(8),
  "Augustine of Hippo": P1(1, 2, 3, 4, 5, 6, 7, 8),
  "John Chrysostom": P1(9, 10, 11, 12, 13, 14),
  "Eusebius of Caesarea": P2(1),
  "Socrates Scholasticus": P2(2),
  "Hermias Sozomen": P2(2),
  "Theodoret of Cyrus": P2(3),
  "Gennadius of Massilia": P2(3),
  "Athanasius of Alexandria": P2(4),
  "Gregory of Nyssa": P2(5),
  "Jerome": P2(3, 6),
  "Tyrannius Rufinus": P2(3, 6),
  "Cyril of Jerusalem": P2(7),
  "Gregory of Nazianzus": P2(7),
  "Basil of Caesarea": P2(8),
  "Hilary of Poitiers": P2(9),
  "John Damascene": P2(9),
  "Ambrose of Milan": P2(10),
  "Sulpicius Severus": P2(11),
  "Vincent of Lérins": P2(11),
  "John Cassian": P2(11),
  "Leo the Great": P2(12),
  "Gregory the Dialogist": P2(12, 13),
  "Ephrem the Syrian": P2(13),
  "Aphrahat the Persian Sage": P2(13),
  "Council of Nicaea of 325": P2(14),
  "Council of Constantinople of 381": P2(14),
  "Council of Ephesus": P2(14),
  "Council of Chalcedon of 451": P2(14),
  "Council of Constantinople of 553": P2(14),
  "Council of Constantinople of 681": P2(14),
  "Council of Nicaea of 787": P2(14),
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const KEYED = new Map(Object.entries(TABLE).map(([k, v]) => [norm(k), v]));

/** The volumes an author appears in, in set order; empty when the author is in none. */
export function volumesFor(author: string): Volume[] {
  return KEYED.get(norm(author)) ?? [];
}

const SERIES_ORDER: Series[] = ["ANF", "NPNF1", "NPNF2"];

/** "ANF 3–4", "NPNF1 9, 11": one author's volumes written compactly, a set at a time. */
export function volumeLabel(vols: Volume[]): string {
  const out: string[] = [];
  for (const s of SERIES_ORDER) {
    const ns = vols.filter((v) => v.series === s).map((v) => v.n).sort((a, b) => a - b);
    if (!ns.length) continue;
    const parts: string[] = [];
    for (let i = 0; i < ns.length; ) {
      let j = i;
      while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
      parts.push(j > i ? `${ns[i]}–${ns[j]}` : String(ns[i]));
      i = j + 1;
    }
    out.push(`${s} ${parts.join(", ")}`);
  }
  return out.join("; ");
}

/** Every volume tag for filtering, e.g. "ANF 3". */
export const volumeTags = (vols: Volume[]): string[] => vols.map((v) => `${v.series} ${v.n}`);

/** The choices a volume filter offers, in order. */
export const ALL_VOLUMES: string[] = [
  ...Array.from({ length: 10 }, (_, i) => `ANF ${i + 1}`),
  ...Array.from({ length: 14 }, (_, i) => `NPNF1 ${i + 1}`),
  ...Array.from({ length: 14 }, (_, i) => `NPNF2 ${i + 1}`),
];
