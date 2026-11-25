/** Writing a MySword-style commentary (.cmt.mybible): a Details table and a Commentary table keyed by Bible passage. */
import { newDatabase } from "../scripture/sqlite";

export interface CommentaryRow {
  /** 1 to 66 (the order of BOOKS) */
  book: number;
  chapter: number;
  verse: number;
  /** first line who and where, then the words, split by a blank line */
  text: string;
}

export async function buildCommentary(title: string, abbreviation: string, comments: string, rows: Iterable<CommentaryRow>): Promise<Uint8Array> {
  const db = await newDatabase();
  try {
    db.run(`create table Details (Description text, Abbreviation text, Comments text, Version text, VersionDate text, PublishDate text, RightToLeft integer, OT integer, NT integer, Strong integer);
create table Commentary (Book integer, ChapterBegin integer, VerseBegin integer, ChapterEnd integer, VerseEnd integer, Comments text);
create index commentary_key on Commentary(Book, ChapterBegin, VerseBegin);`);
    db.run("insert into Details (Description, Abbreviation, Comments, RightToLeft, OT, NT, Strong) values (?,?,?,0,1,1,0)", [title, abbreviation, comments]);
    const st = db.prepare("insert into Commentary values (?,?,?,?,?,?)");
    db.run("begin");
    for (const r of rows) st.run([r.book, r.chapter, r.verse, r.chapter, r.verse, r.text]);
    db.run("commit");
    st.free();
    return db.export();
  } finally {
    db.close();
  }
}
