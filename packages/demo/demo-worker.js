// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.

import * as SQLite from '@/vfs/src/sqlite-api.ts';
import wasmDefault from '@/wasm/dist/wa-sqlite.wasm?url';
import wasmAsync from '@/wasm/dist/wa-sqlite-async.wasm?url';
import wasmJspi from '@/wasm/dist/wa-sqlite-jspi.wasm?url';

const BUILDS = new Map([
  ['default', () => import('@/wasm/dist/wa-sqlite.mjs')],
  ['asyncify', () => import('@/wasm/dist/wa-sqlite-async.mjs')],
  ['jspi', () => import('@/wasm/dist/wa-sqlite-jspi.mjs')],
]);

const WASM_URLS = new Map([
  ['default', wasmDefault],
  ['asyncify', wasmAsync],
  ['jspi', wasmJspi],
]);

/**
 * @typedef Config
 * @property {string} name
 * @property {() => Promise<any>} [loadVfs] lazy loader for the VFS module
 * @property {string} [vfsClassName] name of the VFS class
 * @property {string} [vfsName] name of the VFS instance
 * @property {object} [vfsOptions] VFS constructor arguments
 */

/** @type {Map<string, Config>} */ const VFS_CONFIGS = new Map([
  {
    name: 'default',
  },
  {
    name: 'MemoryVFS',
    loadVfs: () => import('@/vfs/src/vfs/MemoryVFS.ts'),
  },
  {
    name: 'MemoryAsyncVFS',
    loadVfs: () => import('@/vfs/src/vfs/MemoryAsyncVFS.ts'),
  },
  {
    name: 'IDBBatchAtomicVFS',
    loadVfs: () => import('@/vfs/src/vfs/IDBBatchAtomicVFS.ts'),
    vfsOptions: { lockPolicy: 'shared+hint' }
  },
  {
    name: 'IDBMirrorVFS',
    loadVfs: () => import('@/vfs/src/vfs/IDBMirrorVFS.ts'),
    vfsName: 'demo-mirror'
  },
  {
    name: 'OPFSAdaptiveVFS',
    loadVfs: () => import('@/vfs/src/vfs/OPFSAdaptiveVFS.ts'),
    vfsOptions: { lockPolicy: 'shared+hint' }
  },
  {
    name: 'OPFSAnyContextVFS',
    loadVfs: () => import('@/vfs/src/vfs/OPFSAnyContextVFS.ts'),
    vfsOptions: { lockPolicy: 'shared+hint' }
  },
  {
    name: 'OPFSCoopSyncVFS',
    loadVfs: () => import('@/vfs/src/vfs/OPFSCoopSyncVFS.ts'),
  },
  {
    name: 'OPFSPermutedVFS',
    loadVfs: () => import('@/vfs/src/vfs/OPFSPermutedVFS.ts'),
  },
  {
    name: 'AccessHandlePoolVFS',
    loadVfs: () => import('@/vfs/src/vfs/AccessHandlePoolVFS.ts'),
  },
].map(config => [config.name, config]));

const searchParams = new URLSearchParams(location.search);

maybeReset().then(async () => {
  const buildName = searchParams.get('build') || BUILDS.keys().next().value;
  const configName = searchParams.get('config') || VFS_CONFIGS.keys().next().value;
  const config = VFS_CONFIGS.get(configName);

  const dbName = searchParams.get('dbName') ?? 'hello';
  const vfsName = searchParams.get('vfsName') ?? config.vfsName ?? 'demo';

  // Instantiate SQLite.
  const { default: moduleFactory } = await BUILDS.get(buildName)();
  const module = await moduleFactory({ locateFile: () => WASM_URLS.get(buildName) });
  const sqlite3 = SQLite.Factory(module);

  if (config.loadVfs) {
    // Create the VFS and register it as the default file system.
    const namespace = await config.loadVfs();
    const className = config.vfsClassName ?? config.name;
    const vfs = await namespace[className].create(vfsName, module, config.vfsOptions);
    sqlite3.vfs_register(vfs, true);
  }

  // Open the database.
  const db = await sqlite3.open_v2(dbName);

  // Add example functions regex and regex_replace.
  sqlite3.create_function(
    db,
    'regexp', 2,
    SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
    function(context, values) {
      const pattern = new RegExp(sqlite3.value_text(values[0]))
      const s = sqlite3.value_text(values[1]);
      sqlite3.result(context, pattern.test(s) ? 1 : 0);
    },
    null, null);

  sqlite3.create_function(
    db,
    'regexp_replace', -1,
    SQLite.SQLITE_UTF8 | SQLite.SQLITE_DETERMINISTIC, 0,
    function(context, values) {
      // Arguments are
      // (pattern, s, replacement) or
      // (pattern, s, replacement, flags).
      if (values.length < 3) {
        sqlite3.result(context, '');
        return;
      }
      const pattern = sqlite3.value_text(values[0]);
      const s = sqlite3.value_text(values[1]);
      const replacement = sqlite3.value_text(values[2]);
      const flags = values.length > 3 ? sqlite3.value_text(values[3]) : '';
      sqlite3.result(context, s.replace(new RegExp(pattern, flags), replacement));
    },
    null, null);

  // Handle SQL queries.
  addEventListener('message', async (event) => {
    try {
      const query = event.data;

      const start = performance.now();
      const results = [];
      for await (const stmt of sqlite3.statements(db, query)) {
        const rows = [];
        while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
          const row = sqlite3.row(stmt);
          rows.push(row);
        }

        const columns = sqlite3.column_names(stmt)
        if (columns.length) {
          results.push({ columns, rows });
        }
      }
      const end = performance.now();

      postMessage({
        results,
        elapsed: Math.trunc(end - start) / 1000
      })
    } catch (e) {
      console.error(e);
      postMessage({ error: cvtErrorToCloneable(e) });
    }
  });

  // Signal that we're ready.
  postMessage(null);
}).catch(e => {
  console.error(e);
  postMessage({ error: cvtErrorToCloneable(e) });
});

async function maybeReset() {
  if (searchParams.has('reset')) {
    const outerLockReleaser = await new Promise(resolve => {
      navigator.locks.request('demo-worker-outer', lock => {
        return new Promise(release => {
          resolve(release);
        });
      });
    });

    await navigator.locks.request('demo-worker-inner', { ifAvailable: true }, async lock => {
      if (lock) {
        console.log('clearing OPFS and IndexedDB');
        const root = await navigator.storage?.getDirectory();
        if (root) {
          // @ts-ignore
          for await (const name of root.keys()) {
            await root.removeEntry(name, { recursive: true });
          }
        }

        // Clear IndexedDB.
        const dbList = indexedDB.databases ?
          await indexedDB.databases() :
          ['demo', 'demo-floor'].map(name => ({ name }));
        await Promise.all(dbList.map(({name}) => {
          return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = resolve;
            request.onerror = reject;
          });
        }));
      } else {
        console.warn('reset skipped because another instance already holds the lock');
      }
    });

    await new Promise((resolve, reject) => {
      const mode = searchParams.has('exclusive') ? 'exclusive' : 'shared';
      navigator.locks.request('demo-worker-inner', { mode, ifAvailable: true }, lock => {
        if (lock) {
          resolve();
          return new Promise(() => {});
        } else {
          reject(new Error('failed to acquire inner lock'));
        }
      });
    });

    outerLockReleaser();
  }
}

function cvtErrorToCloneable(e) {
  if (e instanceof Error) {
    const props = new Set([
      ...['name', 'message', 'stack'].filter(k => e[k] !== undefined),
      ...Object.getOwnPropertyNames(e)
    ]);
    return Object.fromEntries(Array.from(props, k =>  [k, e[k]])
      .filter(([_, v]) => {
        // Skip any non-cloneable properties.
        try {
          structuredClone(v);
          return true;
        } catch (e) {
          return false;
        }
      }));
  }
  return e;
}
