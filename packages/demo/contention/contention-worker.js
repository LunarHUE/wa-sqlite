import * as SQLite from "@/vfs/src/sqlite-api.ts";
import wasmDefault from '@/wasm/dist/wa-sqlite.wasm?url';
import wasmAsync from '@/wasm/dist/wa-sqlite-async.wasm?url';
import wasmJspi from '@/wasm/dist/wa-sqlite-jspi.wasm?url';

const BROADCAST_CHANNEL_NAME = 'contention';

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
  },
  {
    name: 'OPFSAdaptiveVFS',
    loadVfs: () => import('@/vfs/src/vfs/OPFSAdaptiveVFS.ts'),
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

const releaseTask = (function() {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();

  return function() {
    return new Promise(resolve => {
      port2.onmessage = resolve;
      port1.postMessage(null);
    });
  };
})();

(async function() {
  const broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  const searchParams = new URLSearchParams(globalThis.location.search);
  const index = Number(searchParams.get('index'));
  const type = searchParams.get('type');

  if (index === 0) {
    console.debug('primary worker clearing storage');
    await clearStorage();
  }

  postMessage(null);
  const { build, config: configName, queries } = await new Promise(resolve => {
    broadcastChannel.addEventListener('message', event => {
      resolve(event.data);
    }, { once: true });
  });
  const config = VFS_CONFIGS.get(configName);

  // Instantiate SQLite.
  const { default: moduleFactory } = await BUILDS.get(build)();
  const module = await moduleFactory({ locateFile: () => WASM_URLS.get(build) });
  const sqlite3 = SQLite.Factory(module);

  const dbName = searchParams.get('dbName') ?? 'hello';
  const vfsName = searchParams.get('vfsName') ?? 'demo';
  if (config.loadVfs) {
    // Create the VFS and register it as the default file system.
    const namespace = await config.loadVfs();
    const className = config.vfsClassName ?? config.name;
    const vfs = await namespace[className].create(vfsName, module, config.vfsOptions);
    sqlite3.vfs_register(vfs, true);
  }

  // Open the database.
  if (index === 0) {
    const db = await sqlite3.open_v2(dbName);
    await query(sqlite3, db, queries.global);
    await sqlite3.close(db);
  }
  const db = await sqlite3.open_v2(dbName);
  await new Promise(resolve => setTimeout(resolve));
  await query(sqlite3, db, queries.connection);

  postMessage(null);
  const { endTime } = await new Promise(resolve => {
    broadcastChannel.addEventListener('message', event => {
      resolve(event.data);
    }, { once: true });
  });

  // Run contention test
  let nIterations = 0;
  const sql = type === 'writer' ? queries.writer : queries.reader;
  while (Date.now() < endTime) {
    await query(sqlite3, db, sql);
    await releaseTask();
    nIterations++;
  }
  postMessage(`worker ${index} ${type} ${nIterations} iterations`);
  postMessage(null);
})().catch(e => {
  console.error(e);
  postMessage({ error: e });
});

async function query(sqlite3, db, sql) {
  while (true) {
    try {
      const rc = await sqlite3.exec(db, sql);
      return rc;
    } catch (e) {
      if (e.code === SQLite.SQLITE_BUSY) {
        if (!sqlite3.get_autocommit(db)) {
          await sqlite3.exec(db, 'ROLLBACK;');
        }
        continue;
      }
      throw e;
    }
  }
}

async function clearStorage() {
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
}
