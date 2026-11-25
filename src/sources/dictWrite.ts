/** Writing a MySword-style dictionary (.dct.mybible): a Details table and a dictionary(word, data) table. */
import { newDatabase } from "../scripture/sqlite";
import type { DictRow } from "../resources/dictionaries";

export async function buildDictionary(title: string, abbreviation: string, rows: DictRow[]): Promise<Uint8Array> {
  const db = await newDatabase();
  try {
    db.run(`create table Details (Description text, Abbreviation text, Comments text, Version text, VersionDate text, PublishDate text, RightToLeft integer, OT integer, NT integer, Strong integer);
create table dictionary (word text, data text);
create index dictionary_word on dictionary(word);`);
    db.run("insert into Details (Description, Abbreviation, Comments, RightToLeft, OT, NT, Strong) values (?,?,?,0,1,1,1)", [title, abbreviation, "Made by Booker from an open dictionary."]);
    const st = db.prepare("insert into dictionary values (?,?)");
    db.run("begin");
    for (const r of rows) st.run([r.word, r.text]);
    db.run("commit");
    st.free();
    return db.export();
  } finally {
    db.close();
  }
}
