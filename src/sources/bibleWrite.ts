/** Writing a MySword-style Bible (.bbl.mybible): a Details table and a Bible(Book, Chapter, Verse, Scripture) table. */
import { newDatabase } from "../scripture/sqlite";

export interface BibleRow {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

export async function buildBible(title: string, abbreviation: string, comments: string, rows: Iterable<BibleRow>, strong: boolean): Promise<Uint8Array> {
  const db = await newDatabase();
  try {
    db.run(`create table Details (Description text, Abbreviation text, Comments text, Version text, VersionDate text, PublishDate text, RightToLeft integer, OT integer, NT integer, Strong integer);
create table Bible (Book integer, Chapter integer, Verse integer, Scripture text);
create index bible_key on Bible(Book, Chapter, Verse);`);
    db.run("insert into Details (Description, Abbreviation, Comments, RightToLeft, OT, NT, Strong) values (?,?,?,0,1,1,?)", [title, abbreviation, comments, strong ? 1 : 0]);
    const st = db.prepare("insert into Bible values (?,?,?,?)");
    db.run("begin");
    for (const r of rows) st.run([r.book, r.chapter, r.verse, r.text]);
    db.run("commit");
    st.free();
    return db.export();
  } finally {
    db.close();
  }
}
