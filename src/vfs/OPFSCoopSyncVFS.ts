// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';

const DEFAULT_TEMPORARY_FILES = 10;
const LOCK_NOTIFY_INTERVAL = 1000;

const DB_RELATED_FILE_SUFFIXES = ['', '-journal', '-wal'];

const finalizationRegistry = new FinalizationRegistry((releaser: () => void) => releaser());

class File {
  path: string;
  flags: number;
  accessHandle: FileSystemSyncAccessHandle;
  persistentFile: PersistentFile | null = null;

  constructor(path: string, flags: number) {
    this.path = path;
    this.flags = flags;
  }
}

class PersistentFile {
  fileHandle: FileSystemFileHandle;
  accessHandle: FileSystemSyncAccessHandle | null = null;

  isLockBusy: boolean = false;
  isFileLocked: boolean = false;
  isRequestInProgress: boolean = false;
  handleLockReleaser: (() => void) | null = null;

  handleRequestChannel: BroadcastChannel;
  isHandleRequested: boolean = false;

  constructor(fileHandle: FileSystemFileHandle) {
    this.fileHandle = fileHandle;
  }
}

export class OPFSCoopSyncVFS extends FacadeVFS {
  mapIdToFile: Map<number, File> = new Map();

  lastError: any = null;
  log: any = null;

  persistentFiles: Map<string, PersistentFile> = new Map();
  boundAccessHandles: Map<string, FileSystemSyncAccessHandle> = new Map();
  unboundAccessHandles: Set<FileSystemSyncAccessHandle> = new Set();
  accessiblePaths: Set<string> = new Set();
  releaser: (() => void) | null = null;

  static async create(name: string, module: any): Promise<OPFSCoopSyncVFS> {
    const vfs = new OPFSCoopSyncVFS(name, module);
    await Promise.all([
      vfs.isReady(),
      vfs.#initialize(DEFAULT_TEMPORARY_FILES),
    ]);
    return vfs;
  }

  constructor(name: string, module: any) {
    super(name, module);
  }

  async #initialize(nTemporaryFiles: number): Promise<void> {
    const root = await navigator.storage.getDirectory();
    // @ts-ignore
    for await (const entry of root.values()) {
      if (entry.kind === 'directory' && entry.name.startsWith('.ahp-')) {
        await navigator.locks.request(entry.name, { ifAvailable: true }, async lock => {
          if (lock) {
            this.log?.(`Deleting temporary directory ${entry.name}`);
            await root.removeEntry(entry.name, { recursive: true });
          } else {
            this.log?.(`Temporary directory ${entry.name} is in use`);
          }
        });
      }
    }

    const tmpDirName = `.ahp-${Math.random().toString(36).slice(2)}`;
    this.releaser = await new Promise(resolve => {
      navigator.locks.request(tmpDirName, () => {
        return new Promise(release => {
          resolve(release as () => void);
        });
      });
    });
    finalizationRegistry.register(this, this.releaser);
    const tmpDir = await root.getDirectoryHandle(tmpDirName, { create: true });

    for (let i = 0; i < nTemporaryFiles; i++) {
      const tmpFile = await tmpDir.getFileHandle(`${i}.tmp`, { create: true });
      const tmpAccessHandle = await tmpFile.createSyncAccessHandle();
      this.unboundAccessHandles.add(tmpAccessHandle);
    }
  }

  jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): number {
    try {
      const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
      const path = url.pathname;

      if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
        const persistentFile = this.persistentFiles.get(path);
        if (persistentFile?.isRequestInProgress) {
          return VFS.SQLITE_BUSY;
        } else if (!persistentFile) {
          this.log?.(`creating persistent file for ${path}`);
          const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
          this._module.retryOps.push((async () => {
            try {
              let dirHandle = await navigator.storage.getDirectory();
              const directories = path.split('/').filter(d => d);
              const filename = directories.pop();
              for (const directory of directories) {
                dirHandle = await dirHandle.getDirectoryHandle(directory, { create });
              }

              for (const suffix of DB_RELATED_FILE_SUFFIXES) {
                const fileHandle = await dirHandle.getFileHandle(filename + suffix, { create });
                await this.#createPersistentFile(fileHandle);
              }

              const file = new File(path, flags);
              file.persistentFile = this.persistentFiles.get(path);
              await this.#requestAccessHandle(file);
            } catch (e) {
              const persistentFile = new PersistentFile(null);
              this.persistentFiles.set(path, persistentFile);
              console.error(e);
            }
          })());
          return VFS.SQLITE_BUSY;
        } else if (!persistentFile.fileHandle) {
          this.persistentFiles.delete(path);
          return VFS.SQLITE_CANTOPEN;
        } else if (!persistentFile.accessHandle) {
          this._module.retryOps.push((async () => {
            const file = new File(path, flags);
            file.persistentFile = this.persistentFiles.get(path);
            await this.#requestAccessHandle(file);
          })());
          return VFS.SQLITE_BUSY;
        }
      }

      if (!this.accessiblePaths.has(path) &&
          !(flags & VFS.SQLITE_OPEN_CREATE)) {
        throw new Error(`File ${path} not found`);
      }

      const file = new File(path, flags);
      this.mapIdToFile.set(fileId, file);

      if (this.persistentFiles.has(path)) {
        file.persistentFile = this.persistentFiles.get(path);
      } else if (this.boundAccessHandles.has(path)) {
        file.accessHandle = this.boundAccessHandles.get(path);
      } else if (this.unboundAccessHandles.size) {
        file.accessHandle = this.unboundAccessHandles.values().next().value;
        file.accessHandle.truncate(0);
        this.unboundAccessHandles.delete(file.accessHandle);
        this.boundAccessHandles.set(path, file.accessHandle);
      }
      this.accessiblePaths.add(path);

      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_CANTOPEN;
    }
  }

  jDelete(zName: string, syncDir: number): number {
    try {
      const url = new URL(zName, 'file://');
      const path = url.pathname;
      if (this.persistentFiles.has(path)) {
        const persistentFile = this.persistentFiles.get(path);
        persistentFile.accessHandle.truncate(0);
      } else {
        this.boundAccessHandles.get(path)?.truncate(0);
      }
      this.accessiblePaths.delete(path);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_DELETE;
    }
  }

  jAccess(zName: string, flags: number, pResOut: DataView): number {
    try {
      const url = new URL(zName, 'file://');
      const path = url.pathname;
      pResOut.setInt32(0, this.accessiblePaths.has(path) ? 1 : 0, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_ACCESS;
    }
  }

  jClose(fileId: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      this.mapIdToFile.delete(fileId);

      if (file?.flags & VFS.SQLITE_OPEN_MAIN_DB) {
        if (file.persistentFile?.handleLockReleaser) {
          this.#releaseAccessHandle(file);
        }
      } else if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        file.accessHandle.truncate(0);
        this.accessiblePaths.delete(file.path);
        if (!this.persistentFiles.has(file.path)) {
          this.boundAccessHandles.delete(file.path);
          this.unboundAccessHandles.add(file.accessHandle);
        }
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_CLOSE;
    }
  }

  jRead(fileId: number, pData: Uint8Array, iOffset: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);

      const accessHandle = file.accessHandle || file.persistentFile.accessHandle;
      const bytesRead = accessHandle.read(pData.subarray(), { at: iOffset });

      if ((file.flags & VFS.SQLITE_OPEN_MAIN_DB) && !file.persistentFile.isFileLocked) {
        this.#releaseAccessHandle(file);
      }

      if (bytesRead < pData.byteLength) {
        pData.fill(0, bytesRead);
        return VFS.SQLITE_IOERR_SHORT_READ;
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

      const accessHandle = file.accessHandle || file.persistentFile.accessHandle;
      const nBytes = accessHandle.write(pData.subarray(), { at: iOffset });
      if (nBytes !== pData.byteLength) throw new Error('short write');
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_WRITE;
    }
  }

  jTruncate(fileId: number, iSize: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      const accessHandle = file.accessHandle || file.persistentFile.accessHandle;
      accessHandle.truncate(iSize);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_TRUNCATE;
    }
  }

  jSync(fileId: number, flags: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      const accessHandle = file.accessHandle || file.persistentFile.accessHandle;
      accessHandle.flush();
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSYNC;
    }
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      const accessHandle = file.accessHandle || file.persistentFile.accessHandle;
      const size = accessHandle.getSize();
      pSize64.setBigInt64(0, BigInt(size), true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSTAT;
    }
  }

  jLock(fileId: number, lockType: number): number {
    const file = this.mapIdToFile.get(fileId);
    if (file.persistentFile.isRequestInProgress) {
      file.persistentFile.isLockBusy = true;
      return VFS.SQLITE_BUSY;
    }

    file.persistentFile.isFileLocked = true;
    if (!file.persistentFile.handleLockReleaser) {
      file.persistentFile.handleRequestChannel.onmessage = () => {
        this.log?.(`received notification for ${file.path}`);
        if (file.persistentFile.isFileLocked) {
          file.persistentFile.isHandleRequested = true;
        } else {
          this.#releaseAccessHandle(file);
        }
        file.persistentFile.handleRequestChannel.onmessage = null;
      };

      this.#requestAccessHandle(file);
      this.log?.('returning SQLITE_BUSY');
      file.persistentFile.isLockBusy = true;
      return VFS.SQLITE_BUSY;
    }
    file.persistentFile.isLockBusy = false;
    return VFS.SQLITE_OK;
  }

  jUnlock(fileId: number, lockType: number): number {
    const file = this.mapIdToFile.get(fileId);
    if (lockType === VFS.SQLITE_LOCK_NONE) {
      if (!file.persistentFile.isLockBusy) {
        if (file.persistentFile.isHandleRequested) {
          this.#releaseAccessHandle(file);
          file.persistentFile.isHandleRequested = false;
        }
        file.persistentFile.isFileLocked = false;
      }
    }
    return VFS.SQLITE_OK;
  }

  jFileControl(fileId: number, op: number, pArg: DataView): number | Promise<number> {
    try {
      const file = this.mapIdToFile.get(fileId);
      switch (op) {
        case VFS.SQLITE_FCNTL_PRAGMA:
          const key = extractString(pArg, 4);
          const value = extractString(pArg, 8);
          this.log?.('xFileControl', file.path, 'PRAGMA', key, value);
          switch (key.toLowerCase()) {
            case 'journal_mode':
              if (value &&
                  !['off', 'memory', 'delete', 'wal'].includes(value.toLowerCase())) {
                throw new Error('journal_mode must be "off", "memory", "delete", or "wal"');
              }
              break;
          }
          break;
      }
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR;
    }
    return VFS.SQLITE_NOTFOUND;
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

  async #createPersistentFile(fileHandle: FileSystemFileHandle): Promise<PersistentFile> {
    const persistentFile = new PersistentFile(fileHandle);
    const root = await navigator.storage.getDirectory();
    const relativePath = await root.resolve(fileHandle);
    const path = `/${relativePath.join('/')}`;
    persistentFile.handleRequestChannel = new BroadcastChannel(`ahp:${path}`);
    this.persistentFiles.set(path, persistentFile);

    const f = await fileHandle.getFile();
    if (f.size) {
      this.accessiblePaths.add(path);
    }
    return persistentFile;
  }

  #requestAccessHandle(file: File): Promise<void> {
    console.assert(!file.persistentFile.handleLockReleaser);
    if (!file.persistentFile.isRequestInProgress) {
      file.persistentFile.isRequestInProgress = true;
      this._module.retryOps.push((async () => {
        file.persistentFile.handleLockReleaser = await this.#acquireLock(file.persistentFile);
        try {
          this.log?.(`creating access handles for ${file.path}`);
          await Promise.all(DB_RELATED_FILE_SUFFIXES.map(async suffix => {
            const persistentFile = this.persistentFiles.get(file.path + suffix);
            if (persistentFile) {
              persistentFile.accessHandle =
                await persistentFile.fileHandle.createSyncAccessHandle();
            }
          }));
        } catch (e) {
          this.log?.(`failed to create access handles for ${file.path}`, e);
          this.#releaseAccessHandle(file);
          throw e;
        } finally {
          file.persistentFile.isRequestInProgress = false;
        }
      })());
      return this._module.retryOps.at(-1);
    }
    return Promise.resolve();
  }

  #releaseAccessHandle(file: File): void {
    DB_RELATED_FILE_SUFFIXES.forEach(suffix => {
      const persistentFile = this.persistentFiles.get(file.path + suffix);
      if (persistentFile) {
        persistentFile.accessHandle?.close();
        persistentFile.accessHandle = null;
      }
    });
    this.log?.(`access handles closed for ${file.path}`);

    file.persistentFile.handleLockReleaser?.();
    file.persistentFile.handleLockReleaser = null;
    this.log?.(`lock released for ${file.path}`);
  }

  #acquireLock(persistentFile: PersistentFile): Promise<() => void> {
    return new Promise(resolve => {
      const lockName = persistentFile.handleRequestChannel.name;
      const notify = () => {
        this.log?.(`notifying for ${lockName}`);
        persistentFile.handleRequestChannel.postMessage(null);
      };
      const notifyId = setInterval(notify, LOCK_NOTIFY_INTERVAL);
      setTimeout(notify);

      this.log?.(`lock requested: ${lockName}`);
      navigator.locks.request(lockName, lock => {
        this.log?.(`lock acquired: ${lockName}`, lock);
        clearInterval(notifyId);
        return new Promise(resolve);
      });
    });
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
