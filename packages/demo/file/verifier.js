import SQLiteESMFactory from '@/wasm/dist/wa-sqlite-async.mjs';
import * as SQLite from '@/vfs/src/sqlite-api.ts';
import { IDBBatchAtomicVFS as MyVFS } from "@/vfs/src/vfs/IDBBatchAtomicVFS.ts";
// import { IDBMirrorVFS as MyVFS } from "@/vfs/src/vfs/IDBMirrorVFS.ts";

const SEARCH_PARAMS = new URLSearchParams(location.search);
const IDB_NAME = SEARCH_PARAMS.get('idb') ?? 'sqlite-vfs';
const DB_NAME = SEARCH_PARAMS.get('db') ?? 'sqlite.db';

(async function() {
  const module = await SQLiteESMFactory();
  const sqlite3 = SQLite.Factory(module);

  const vfs = await MyVFS.create(IDB_NAME, module);
  // @ts-ignore
  sqlite3.vfs_register(vfs, true);

  const db = await sqlite3.open_v2(DB_NAME, SQLite.SQLITE_OPEN_READWRITE, IDB_NAME);

  const results = []
  await sqlite3.exec(db, 'PRAGMA integrity_check;', (row, columns) => {
    results.push(row[0]);
  });
  await sqlite3.close(db);
  
  postMessage(results);
})();