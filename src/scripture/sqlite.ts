/** SQLite files (e-Sword, MySword) read with sql.js, loaded only when a module is first opened. */
import type { Database, SqlJsStatic } from "sql.js";

let loader: () => Promise<Uint8Array> = async () => (await import("./wasm")).default;
let sql: Promise<SqlJsStatic> | null = null;

/** Tests, and anything else that has its own copy of the engine, supply the wasm bytes here. */
export function configureSql(l: () => Promise<Uint8Array>) {
  loader = l;
  sql = null;
}

async function engine(): Promise<SqlJsStatic> {
  sql ??= (async () => {
    const wasmBinary = await loader();
    const init = ((await import("sql.js")) as any).default as (c: { wasmBinary: ArrayBuffer }) => Promise<SqlJsStatic>;
    return init({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer });
  })();
  return sql;
}

/** An empty in-memory database, for writing a new file. */
export async function newDatabase(): Promise<Database> {
  const SQL = await engine();
  return new SQL.Database();
}

export async function openDb(bytes: Uint8Array): Promise<Database> {
  const SQL = await engine();
  const db = new SQL.Database(bytes);
  // a locked or damaged file only fails on the first real query
  db.exec("select count(*) from sqlite_master");
  return db;
}

export function rows(db: Database, query: string, params: Array<string | number> = []): Array<Record<string, any>> {
  const st = db.prepare(query);
  try {
    st.bind(params);
    const out: Array<Record<string, any>> = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}

export function tables(db: Database): string[] {
  return rows(db, "select name from sqlite_master where type='table' and name not like 'sqlite_%'").map((r) => String(r.name));
}

export function columns(db: Database, table: string): string[] {
  return rows(db, `pragma table_info("${table.replace(/"/g, "")}")`).map((r) => String(r.name));
}
