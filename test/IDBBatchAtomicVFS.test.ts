import { TestContext } from './TestContext.ts';
import { vfs_xOpen } from './vfs_xOpen.ts';
import { vfs_xAccess } from './vfs_xAccess.ts';
import { vfs_xClose } from './vfs_xClose.ts';
import { vfs_xRead } from './vfs_xRead.ts';
import { vfs_xWrite } from './vfs_xWrite.ts';
import { expect } from './helpers.ts';

import SQLiteESMFactory from '../dist/wa-sqlite-async.mjs';
import * as SQLite from '../src/sqlite-api.js';
import { IDBBatchAtomicVFS } from '../src/examples/IDBBatchAtomicVFS.js';

const CONFIG = 'IDBBatchAtomicVFS';
const BUILDS = ['asyncify', 'jspi'];

const supportsJSPI = await TestContext.supportsJSPI();

describe(CONFIG, function() {
  for (const build of BUILDS) {
    if (build === 'jspi' && !supportsJSPI) return;

    describe(build, function() {
      const context = new TestContext({ build, config: CONFIG });

      vfs_xAccess(context);
      vfs_xOpen(context);
      vfs_xClose(context);
      vfs_xRead(context);
      vfs_xWrite(context);
    });
  }

  it('should upgrade v5', async function() {
    await idbX(indexedDB.deleteDatabase('test'));

    {
      // Load IndexedDB with v5 data.
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('test', 5);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('blocks', {
            keyPath: ['path', 'offset', 'version']
          }).createIndex('version', ['path', 'version']);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const data = await fetch(new URL('./data/idbv5.json', import.meta.url))
        .then(response => response.json());
      const blocks = db.transaction('blocks', 'readwrite').objectStore('blocks');
      await Promise.all(data.blocks.map((block: any) => {
        block.data = new Uint8Array(block.data);
        return idbX(blocks.put(block));
      }));
      db.close();
    }

    // Initialize SQLite.
    const module = await (SQLiteESMFactory as any)();
    const sqlite3 = SQLite.Factory(module);

    const vfs = await IDBBatchAtomicVFS.create('test', module);
    // @ts-ignore
    sqlite3.vfs_register(vfs, true);

    const db = await sqlite3.open_v2('demo');

    let integrity = '';
    await sqlite3.exec(db, 'PRAGMA integrity_check', (row: unknown[], columns: string[]) => {
      integrity = row[0] as string;
    });
    expect(integrity).to.equal('ok');

    const rows: unknown[] = [];
    await sqlite3.exec(db, 'SELECT x FROM foo ORDER BY rowid LIMIT 3', (row: unknown[], columns: string[]) => {
      rows.push(row[0]);
    });
    expect(rows).to.deep.equal([1, 2, 3]);

    await sqlite3.close(db);
    await vfs.close();

    await idbX(indexedDB.deleteDatabase('test'));
  });
});

function idbX(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
