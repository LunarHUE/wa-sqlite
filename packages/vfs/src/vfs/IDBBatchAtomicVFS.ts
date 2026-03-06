// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';
import { WebLocksMixin } from '../WebLocksMixin';

const RETRYABLE_ERRORS = new Set([
  'TransactionInactiveError',
  'InvalidStateError'
]);

interface Metadata {
  name: string;
  fileSize: number;
  version: number;
  pendingVersion?: number;
}

class File {
  path: string;
  flags: number;

  metadata: Metadata;
  fileSize: number = 0;

  needsMetadataSync: boolean = false;
  rollback: Metadata | null = null;
  changedPages: Set<number> = new Set();

  synchronous: string = 'full';
  txOptions: IDBTransactionOptions = { durability: 'strict' };

  constructor(path: string, flags: number, metadata: Metadata) {
    this.path = path;
    this.flags = flags;
    this.metadata = metadata;
  }
}

export class IDBBatchAtomicVFS extends WebLocksMixin(FacadeVFS) {
  mapIdToFile: Map<number, File> = new Map();
  lastError: any = null;

  log: any = null;

  #isReady: Promise<void>;
  #idb: IDBContext;

  static async create(name: string, module: any, options?: any): Promise<IDBBatchAtomicVFS> {
    const vfs = new IDBBatchAtomicVFS(name, module, options);
    await vfs.isReady();
    return vfs;
  }

  constructor(name: string, module: any, options: any = {}) {
    super(name, module, options);
    this.#isReady = this.#initialize(options.idbName ?? name);
  }

  async #initialize(name: string): Promise<void> {
    this.#idb = await IDBContext.create(name);
  }

  close(): void {
    this.#idb.close();
  }

  async isReady(): Promise<void> {
    await super.isReady();
    await this.#isReady;
  }

  getFilename(fileId: number): string {
    const pathname = this.mapIdToFile.get(fileId).path;
    return `IDB(${this.name}):${pathname}`;
  }

  async jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): Promise<number> {
    try {
      const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
      const path = url.pathname;

      let meta = await this.#idb.q(({ metadata }) => metadata.get(path));
      if (!meta && (flags & VFS.SQLITE_OPEN_CREATE)) {
        meta = {
          name: path,
          fileSize: 0,
          version: 0
        };
        await this.#idb.q(({ metadata }) => metadata.put(meta), 'rw');
      }

      if (!meta) {
        throw new Error(`File ${path} not found`);
      }

      const file = new File(path, flags, meta);
      this.mapIdToFile.set(fileId, file);
      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_CANTOPEN;
    }
  }

  async jDelete(zName: string, syncDir: number): Promise<number> {
    try {
      const url = new URL(zName, 'file://');
      const path = url.pathname;

      this.#idb.q(({ metadata, blocks }) => {
        const range = IDBKeyRange.bound([path, -Infinity], [path, Infinity]);
        blocks.delete(range);
        metadata.delete(path);
      }, 'rw');

      if (syncDir) {
        await this.#idb.sync(false);
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_DELETE;
    }
  }

  async jAccess(zName: string, flags: number, pResOut: DataView): Promise<number> {
    try {
      const url = new URL(zName, 'file://');
      const path = url.pathname;

      const meta = await this.#idb.q(({ metadata }) => metadata.get(path));
      pResOut.setInt32(0, meta ? 1 : 0, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_ACCESS;
    }
  }

  async jClose(fileId: number): Promise<number> {
    try {
      const file = this.mapIdToFile.get(fileId);
      this.mapIdToFile.delete(fileId);

      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        await this.#idb.q(({ metadata, blocks }) => {
          metadata.delete(file.path);
          blocks.delete(IDBKeyRange.bound([file.path, 0], [file.path, Infinity]));
        }, 'rw');
      }

      if (file.needsMetadataSync) {
        this.#idb.q(({ metadata }) => metadata.put(file.metadata), 'rw');
      }
      await this.#idb.sync(file.synchronous === 'full');
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_CLOSE;
    }
  }

  async jRead(fileId: number, pData: Uint8Array, iOffset: number): Promise<number> {
    try {
      const file = this.mapIdToFile.get(fileId);

      let pDataOffset = 0;
      while (pDataOffset < pData.byteLength) {
        const fileOffset = iOffset + pDataOffset;
        const block = await this.#idb.q(({ blocks }) => {
          const range = IDBKeyRange.bound([file.path, -fileOffset], [file.path, Infinity]);
          return blocks.get(range);
        });

        if (!block || block.data.byteLength - block.offset <= fileOffset) {
          pData.fill(0, pDataOffset);
          return VFS.SQLITE_IOERR_SHORT_READ;
        }

        const dst = pData.subarray(pDataOffset);
        const srcOffset = fileOffset + block.offset;
        const nBytesToCopy = Math.min(
          Math.max(block.data.byteLength - srcOffset, 0),
          dst.byteLength);
        dst.set(block.data.subarray(srcOffset, srcOffset + nBytesToCopy));
        pDataOffset += nBytesToCopy;
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_READ;
    }
  }

  jWrite(fileId: number, pData: Uint8Array, iOffset: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        if (!file.rollback) {
          const pending = Object.assign(
            { pendingVersion: file.metadata.version - 1 },
            file.metadata);
          this.#idb.q(({ metadata }) => metadata.put(pending), 'rw', file.txOptions);

          file.rollback = Object.assign({}, file.metadata);
          file.metadata.version--;
        }
      }

      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        file.changedPages.add(iOffset);
      }

      const data = pData.slice();
      const version = file.metadata.version;
      const isOverwrite = iOffset < file.metadata.fileSize;
      if (!isOverwrite ||
          file.flags & VFS.SQLITE_OPEN_MAIN_DB ||
          file.flags & VFS.SQLITE_OPEN_TEMP_DB) {
        const block = {
          path: file.path,
          offset: -iOffset,
          version: version,
          data: pData.slice()
        };
        this.#idb.q(({ blocks }) => {
          blocks.put(block);
          file.changedPages.add(iOffset);
        }, 'rw', file.txOptions);
      } else {
        this.#idb.q(async ({ blocks }) => {
          const range = IDBKeyRange.bound(
            [file.path, -iOffset],
            [file.path, Infinity]);
          const block = await blocks.get(range);

          // @ts-ignore
          block.data.subarray(iOffset + block.offset).set(data);

          blocks.put(block);
        }, 'rw', file.txOptions);
      }

      if (file.metadata.fileSize < iOffset + pData.length) {
        file.metadata.fileSize = iOffset + pData.length;
        file.needsMetadataSync = true;
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_WRITE;
    }
  }

  jTruncate(fileId: number, iSize: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (iSize < file.metadata.fileSize) {
        this.#idb.q(({ blocks }) => {
          const range = IDBKeyRange.bound(
            [file.path, -Infinity],
            [file.path, -iSize, Infinity]);
          blocks.delete(range);
        }, 'rw', file.txOptions);
        file.metadata.fileSize = iSize;
        file.needsMetadataSync = true;
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_TRUNCATE;
    }
  }

  async jSync(fileId: number, flags: number): Promise<number> {
    try {
      const file = this.mapIdToFile.get(fileId);
      if (file.needsMetadataSync) {
        this.#idb.q(({ metadata }) => metadata.put(file.metadata), 'rw', file.txOptions);
        file.needsMetadataSync = false;
      }

      if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        if (file.synchronous === 'full') {
          await this.#idb.sync(true);
        }
      } else {
        await this.#idb.sync(file.synchronous === 'full');
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSYNC;
    }
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      pSize64.setBigInt64(0, BigInt(file.metadata.fileSize), true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSTAT;
    }
  }

  async jLock(fileId: number, lockType: number): Promise<number> {
    const file = this.mapIdToFile.get(fileId);
    const result = await super.jLock(fileId, lockType);

    if (lockType === VFS.SQLITE_LOCK_SHARED) {
      file.metadata = await this.#idb.q(async ({ metadata, blocks }) => {
        // @ts-ignore
        const m: Metadata = await metadata.get(file.path);
        if (m.pendingVersion) {
          console.warn(`removing failed transaction ${m.pendingVersion}`);
          await new Promise((resolve, reject) => {
            const range = IDBKeyRange.bound([m.name, -Infinity], [m.name, Infinity]);
            const request = blocks.openCursor(range);
            request.onsuccess = () => {
              const cursor = request.result;
              if (cursor) {
                const block = cursor.value;
                if (block.version < m.version) {
                  cursor.delete();
                }
                cursor.continue();
              } else {
                resolve(undefined);
              }
            };
            request.onerror = () => reject(request.error);
          });

          delete m.pendingVersion;
          metadata.put(m);
        }
        return m;
      }, 'rw', file.txOptions);
    }
    return result;
  }

  async jUnlock(fileId: number, lockType: number): Promise<number> {
    if (lockType === VFS.SQLITE_LOCK_NONE) {
      const file = this.mapIdToFile.get(fileId);
      await this.#idb.sync(file.synchronous === 'full');
    }

    return super.jUnlock(fileId, lockType);
  }

  jFileControl(fileId: number, op: number, pArg: DataView): number | Promise<number> {
    try {
      const file = this.mapIdToFile.get(fileId);
      switch (op) {
        case VFS.SQLITE_FCNTL_PRAGMA:
          const key = extractString(pArg, 4);
          const value = extractString(pArg, 8);
          this.log?.('xFileControl', file.path, 'PRAGMA', key, value);
          const setPragmaResponse = (response: string) => {
            const encoded = new TextEncoder().encode(response);
            const out = this._module._sqlite3_malloc(encoded.byteLength);
            const outArray = this._module.HEAPU8.subarray(out, out + encoded.byteLength);
            outArray.set(encoded);
            pArg.setUint32(0, out, true);
            return VFS.SQLITE_ERROR;
          };
          switch (key.toLowerCase()) {
            case 'page_size':
              if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
                if (value && file.metadata.fileSize) {
                  return VFS.SQLITE_ERROR;
                }
              }
              break;
            case 'synchronous':
              if (value) {
                switch (value.toLowerCase()) {
                  case '0':
                  case 'off':
                    file.synchronous = 'off';
                    file.txOptions = { durability: 'relaxed' };
                    break;
                  case '1':
                  case 'normal':
                    file.synchronous = 'normal';
                    file.txOptions = { durability: 'relaxed' };
                    break;
                  case '2':
                  case '3':
                  case 'full':
                  case 'extra':
                    file.synchronous = 'full';
                    file.txOptions = { durability: 'strict' };
                    break;
                }
              }
              break;
            case 'write_hint':
              return super.jFileControl(fileId, WebLocksMixin.WRITE_HINT_OP_CODE, null);
          }
          break;
        case VFS.SQLITE_FCNTL_SYNC:
          this.log?.('xFileControl', file.path, 'SYNC');
          if (file.rollback) {
            const commitMetadata = Object.assign({}, file.metadata);
            const prevFileSize = file.rollback.fileSize;
            this.#idb.q(({ metadata, blocks }) => {
              metadata.put(commitMetadata);

              for (const offset of file.changedPages) {
                if (offset < prevFileSize) {
                  const range = IDBKeyRange.bound(
                    [file.path, -offset, commitMetadata.version],
                    [file.path, -offset, Infinity],
                    true);
                  blocks.delete(range);
                }
              }
              file.changedPages.clear();
            }, 'rw', file.txOptions);
            file.needsMetadataSync = false;
            file.rollback = null;
          }
          break;
        case VFS.SQLITE_FCNTL_BEGIN_ATOMIC_WRITE:
          this.log?.('xFileControl', file.path, 'BEGIN_ATOMIC_WRITE');
          return VFS.SQLITE_OK;
        case VFS.SQLITE_FCNTL_COMMIT_ATOMIC_WRITE:
          this.log?.('xFileControl', file.path, 'COMMIT_ATOMIC_WRITE');
          return VFS.SQLITE_OK;
        case VFS.SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE:
          this.log?.('xFileControl', file.path, 'ROLLBACK_ATOMIC_WRITE');
          file.metadata = file.rollback;
          const rollbackMetadata = Object.assign({}, file.metadata);
          this.#idb.q(({ metadata, blocks }) => {
            metadata.put(rollbackMetadata);

            for (const offset of file.changedPages) {
              blocks.delete([file.path, -offset, rollbackMetadata.version - 1]);
            }
            file.changedPages.clear();
          }, 'rw', file.txOptions);
          file.needsMetadataSync = false;
          file.rollback = null;
          return VFS.SQLITE_OK;
      }
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR;
    }
    return super.jFileControl(fileId, op, pArg);
  }

  jDeviceCharacteristics(pFile: number): number {
    return 0
    | VFS.SQLITE_IOCAP_BATCH_ATOMIC
    | VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  jGetLastError(zBuf: Uint8Array): number {
    if (this.lastError) {
      console.error(this.lastError);
      const outputArray = zBuf.subarray(0, zBuf.byteLength - 1);
      const { written } = new TextEncoder().encodeInto(this.lastError.message, outputArray);
      zBuf[written] = 0;
    }
    return VFS.SQLITE_OK;
  }
}

function extractString(dataView: DataView, offset: number): string | null {
  const p = dataView.getUint32(offset, true);
  if (p) {
    const chars = new Uint8Array(dataView.buffer, p);
    return new TextDecoder().decode(chars.subarray(0, chars.indexOf(0)));
  }
  return null;
}

export class IDBContext {
  #database: IDBDatabase;

  #chain: Promise<any> | null = null;
  #txComplete: Promise<any> = Promise.resolve();
  #request: IDBRequest | null = null;
  #txPending: WeakSet<IDBTransaction> = new WeakSet();

  log: any = null;

  static async create(name: string): Promise<IDBContext> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 6);
      request.onupgradeneeded = async event => {
        const db = request.result;
        if (event.oldVersion) {
          console.log(`Upgrading IndexedDB from version ${event.oldVersion}`);
        }
        switch (event.oldVersion) {
          case 0:
            db.createObjectStore('blocks', { keyPath: ['path', 'offset', 'version']})
              .createIndex('version', ['path', 'version']);
            // fall through intentionally
          case 5:
            const tx = request.transaction;
            const blocks = tx.objectStore('blocks');
            blocks.deleteIndex('version');
            const metadata = db.createObjectStore('metadata', { keyPath: 'name' });

            await new Promise<void>((resolve, reject) => {
              let lastBlock: any = {};
              const request = tx.objectStore('blocks').openCursor();
              request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                  const block = cursor.value;
                  if (typeof block.offset !== 'number' ||
                      (block.path === lastBlock.path && block.offset === lastBlock.offset)) {
                    cursor.delete();
                  } else if (block.offset === 0) {
                    metadata.put({
                      name: block.path,
                      fileSize: block.fileSize,
                      version: block.version
                    });

                    delete block.fileSize;
                    cursor.update(block);
                  }
                  lastBlock = block;
                  cursor.continue();
                } else {
                  resolve();
                }
              };
              request.onerror = () => reject(request.error);
            });
            break;
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new IDBContext(database);
  }

  constructor(database: IDBDatabase) {
    this.#database = database;
  }

  close(): void {
    this.#database.close();
  }

  q(f: (stores: Record<string, any>) => any, mode: 'ro' | 'rw' = 'ro', options: any = {}): Promise<any> {
    const txMode: IDBTransactionMode = mode === 'ro' ? 'readonly' : 'readwrite';
    const txOptions = Object.assign({ durability: 'default' }, options);

    this.#chain = (this.#chain || Promise.resolve())
      .then(() => this.#q(f, txMode, txOptions));
    return this.#chain;
  }

  async #q(f: (stores: Record<string, any>) => any, mode: IDBTransactionMode, options: any): Promise<any> {
    let tx: IDBTransaction;
    if (this.#request &&
        this.#txPending.has(this.#request.transaction) &&
        this.#request.transaction.mode >= mode &&
        (this.#request.transaction as any).durability === options.durability) {
      tx = this.#request.transaction;

      if (this.#request.readyState === 'pending') {
        await new Promise(resolve => {
          this.#request.addEventListener('success', resolve, { once: true });
          this.#request.addEventListener('error', resolve, { once: true });
        });
      }
    }

    for (let i = 0; i < 2; ++i) {
      if (!tx) {
        await this.#txComplete;

        // @ts-ignore
        tx = this.#database.transaction(this.#database.objectStoreNames, mode, options);
        this.log?.('IDBTransaction open', mode);
        this.#txPending.add(tx);
        this.#txComplete = new Promise((resolve, reject) => {
          tx.addEventListener('complete', () => {
            this.log?.('IDBTransaction complete');
            this.#txPending.delete(tx);
            resolve(undefined);
          });
          tx.addEventListener('abort', () => {
            this.#txPending.delete(tx);
            reject(new Error('transaction aborted'));
          });
        });
      }

      try {
        // @ts-ignore
        const objectStores = [...tx.objectStoreNames].map(name => {
          return [name, this.proxyStoreOrIndex(tx.objectStore(name))];
        });

        return await f(Object.fromEntries(objectStores));
      } catch (e: any) {
        if (!i && RETRYABLE_ERRORS.has(e.name)) {
          this.log?.(`${e.name}, retrying`);
          tx = null;
          continue;
        }
        throw e;
      }
    }
  }

  proxyStoreOrIndex(objectStore: IDBObjectStore): any {
    return new Proxy(objectStore, {
      get: (target, property, receiver) => {
        const result = Reflect.get(target, property, receiver);
        if (typeof result === 'function') {
          return (...args: any[]) => {
            const maybeRequest = Reflect.apply(result, target, args);
            // @ts-ignore
            if (maybeRequest instanceof IDBRequest && !String(property).endsWith('Cursor')) {
              this.#request = maybeRequest;

              maybeRequest.addEventListener('error', () => {
                console.error(maybeRequest.error);
                maybeRequest.transaction.abort();
              }, { once: true });

              return wrap(maybeRequest);
            }
            return maybeRequest;
          };
        }
        return result;
      }
    });
  }

  async sync(durable: boolean): Promise<void> {
    if (this.#chain) {
      await this.#chain;
      if (durable) {
        await this.#txComplete;
      }
      this.reset();
    }
  }

  reset(): void {
    this.#chain = null;
    this.#txComplete = Promise.resolve();
    this.#request = null;
  }
}

function wrap(request: IDBRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
