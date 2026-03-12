// @lunarhue/expo-wa-sqlite
// Expo + React + Drizzle adapter for wa-sqlite with IDBBatchAtomicVFS

import * as SQLite from '@lunarhue/wa-sqlite';
import { IDBBatchAtomicVFS } from '@lunarhue/wa-sqlite/vfs/IDBBatchAtomicVFS';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { DrizzleConfig } from 'drizzle-orm';
import { useEffect, useState } from 'react';

export interface WaSQLiteOptions {
  /**
   * The SQLite database filename (also used as the IDB database name by default).
   */
  dbName: string;

  /**
   * The wa-sqlite WASM module factory. Import this from your bundler:
   *   import WaFactory from '@lunarhue/wa-sqlite-wasm/wa-sqlite-async.mjs'
   * Then pass it here.
   */
  moduleFactory: (options?: { locateFile?: (filename: string) => string }) => Promise<any>;

  /**
   * Optional URL for the WASM binary. Needed when the default fetch location
   * doesn't match your deployment (e.g. CDN, custom base path).
   */
  wasmUrl?: string;

  /**
   * The name of the VFS instance (and IDB database). Defaults to `dbName`.
   */
  vfsName?: string;

  /**
   * Options forwarded to IDBBatchAtomicVFS.create().
   * Defaults to `{ lockPolicy: 'shared+hint' }`.
   */
  vfsOptions?: Record<string, any>;
}

interface Connection {
  sqlite3: any;
  db: number;
  queue: Promise<any>; 
}

// Module-level singleton: one open connection per dbName.
// Keyed by dbName, so even React StrictMode's double-invoke of effects
// can't create two connections for the same database.
const connections = new Map<string, Promise<Connection>>();

async function openConnection(options: WaSQLiteOptions): Promise<Connection> {
  const {
    dbName,
    moduleFactory,
    wasmUrl,
    vfsName = dbName,
    vfsOptions = { lockPolicy: 'shared+hint' },
  } = options;

  const moduleOptions = wasmUrl ? { locateFile: () => wasmUrl } : {};
  const module = await moduleFactory(moduleOptions);
  const sqlite3 = SQLite.Factory(module);

  const vfs = await IDBBatchAtomicVFS.create(vfsName, module, vfsOptions);
  sqlite3.vfs_register(vfs, /* makeDefault */ true);

  const db = await sqlite3.open_v2(dbName);

  return { sqlite3, db, queue: Promise.resolve() };
}

function getOrCreateConnection(options: WaSQLiteOptions): Promise<Connection> {
  if (!connections.has(options.dbName)) {
    connections.set(options.dbName, openConnection(options));
  }
  return connections.get(options.dbName)!;
}

function makeCallback(conn: Connection) {
  const { sqlite3, db } = conn;

  return async (
    sql: string,
    params: any[],
    _method: 'run' | 'all' | 'values' | 'get',
  ): Promise<{ rows: any }> => {
    const task = async () => {
      while (true) {
        try {
          const rows: any[][] = [];

          for await (const stmt of sqlite3.statements(db, sql)) {
            if (params.length > 0) {
              sqlite3.bind_collection(stmt, params);
            }
            while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
              rows.push(sqlite3.row(stmt));
            }
          }

          switch (_method) {
            case 'run':
              return { rows: [] };
            case 'get':
              return { rows: rows[0] };
            case 'all':
            case 'values':
            default:
              return { rows };
          }
        } catch (e: any) {
          if (e.code === SQLite.SQLITE_BUSY) {
            if (!sqlite3.get_autocommit(db)) {
              await sqlite3.exec(db, 'ROLLBACK;');
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
            continue;
          }
          
          console.error('Drizzle/WASM Error:', e);
          throw e;
        }
      }
    };

    const result = conn.queue.then(task, task);
    conn.queue = result.catch(() => {}) as Promise<any>;
    return result;
  };
}

/**
 * Initializes wa-sqlite with IDBBatchAtomicVFS and returns a Drizzle database.
 * The underlying connection is a singleton per `dbName` — safe to call multiple
 * times with the same name.
 */
export async function openWaSQLiteDB<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  options: WaSQLiteOptions,
  config?: DrizzleConfig<TSchema>,
): Promise<SqliteRemoteDatabase<TSchema>> {
  const conn = await getOrCreateConnection(options);
  return drizzle(makeCallback(conn), config) as SqliteRemoteDatabase<TSchema>;
}

interface HookState<TSchema extends Record<string, unknown>> {
  db: SqliteRemoteDatabase<TSchema> | null;
  error: Error | null;
  isReady: boolean;
}

/**
 * React hook that opens a wa-sqlite database backed by IDBBatchAtomicVFS.
 *
 * The underlying connection is a module-level singleton keyed by `dbName`,
 * so it is safe under React StrictMode — the VFS is only created once even
 * if the effect fires twice.
 *
 * @example
 * import WaFactory from '@lunarhue/wa-sqlite-wasm/wa-sqlite-async.mjs'
 * import { useWaSQLiteDB } from '@lunarhue/expo-wa-sqlite'
 *
 * function App() {
 *   const { db, isReady, error } = useWaSQLiteDB({ dbName: 'myapp', moduleFactory: WaFactory })
 *   if (!isReady) return <Loading />
 *   // use db with drizzle queries …
 * }
 */
export function useWaSQLiteDB<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  options: WaSQLiteOptions,
  config?: DrizzleConfig<TSchema>,
): HookState<TSchema> {
  const [state, setState] = useState<HookState<TSchema>>({
    db: null,
    error: null,
    isReady: false,
  });

  // Capture stable references so the effect doesn't re-run on object identity changes.
  const { dbName } = options;

  useEffect(() => {
    let cancelled = false;

    getOrCreateConnection(options)
      .then((conn) => {
        if (cancelled) return;
        const drizzleDb = drizzle(
          makeCallback(conn),
          config,
        ) as SqliteRemoteDatabase<TSchema>;
        setState({ db: drizzleDb, error: null, isReady: true });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          db: null,
          error: err instanceof Error ? err : new Error(String(err)),
          isReady: false,
        });
      });

    // Cleanup only cancels the setState — the connection itself is kept alive
    // for the lifetime of the module (safe to reuse across remounts).
    return () => {
      cancelled = true;
    };
  // Only re-run if the database name changes. All other options are treated as
  // stable initialisation config (changing them after the first open has no effect).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbName]);

  return state;
}
