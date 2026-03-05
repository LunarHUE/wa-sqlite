// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';
import { WebLocksMixin } from '../WebLocksMixin';

const LOCK_NOTIFY_INTERVAL = 1000;

const hasUnsafeAccessHandle =
  globalThis.FileSystemSyncAccessHandle.prototype.hasOwnProperty('mode');

async function getPathComponents(pathname: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
  const [_, directories, filename] = pathname.match(/[/]?(.*)[/](.*)$/);

  let directoryHandle = await navigator.storage.getDirectory();
  for (const directory of directories.split('/')) {
    if (directory) {
      directoryHandle = await directoryHandle.getDirectoryHandle(directory, { create });
    }
  }
  return [directoryHandle, filename];
}

class File {
  pathname: string;
  flags: number;
  fileHandle: FileSystemFileHandle;
  accessHandle: FileSystemSyncAccessHandle;

  handleRequestChannel: BroadcastChannel;
  handleLockReleaser: (() => void) | null = null;
  isHandleRequested: boolean = false;
  isFileLocked: boolean = false;

  openLockReleaser: (() => void) | null = null;

  constructor(pathname: string, flags: number) {
    this.pathname = pathname;
    this.flags = flags;
  }
}

export class OPFSAdaptiveVFS extends WebLocksMixin(FacadeVFS) {
  mapIdToFile: Map<number, File> = new Map();
  lastError: any = null;

  log: any = null;

  static async create(name: string, module: any, options?: any): Promise<OPFSAdaptiveVFS> {
    const vfs = new OPFSAdaptiveVFS(name, module, options);
    await vfs.isReady();
    return vfs;
  }

  constructor(name: string, module: any, options: any = {}) {
    super(name, module, options);
  }

  getFilename(fileId: number): string {
    const pathname = this.mapIdToFile.get(fileId).pathname;
    return `OPFS:${pathname}`;
  }

  async jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): Promise<number> {
    try {
      const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
      const pathname = url.pathname;

      const file = new File(pathname, flags);
      this.mapIdToFile.set(fileId, file);

      const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
      const [directoryHandle, filename] = await getPathComponents(pathname, create);
      file.fileHandle = await directoryHandle.getFileHandle(filename, { create });

      if ((flags & VFS.SQLITE_OPEN_MAIN_DB) && !hasUnsafeAccessHandle) {
        file.handleRequestChannel = new BroadcastChannel(this.getFilename(fileId));

        function notify() {
          file.handleRequestChannel.postMessage(null);
        }
        const notifyId = setInterval(notify, LOCK_NOTIFY_INTERVAL);
        setTimeout(notify);

        file.openLockReleaser = await new Promise((resolve, reject) => {
          navigator.locks.request(this.getFilename(fileId), lock => {
            clearInterval(notifyId);
            if (!lock) return reject();
            return new Promise(release => {
              resolve(release as () => void);
            });
          });
        });
        this.log?.('access handle acquired for open');
      }

      // @ts-ignore
      file.accessHandle = await file.fileHandle.createSyncAccessHandle({
        mode: 'readwrite-unsafe'
      });

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
      const pathname = url.pathname;

      const [directoryHandle, name] = await getPathComponents(pathname, false);
      const result = directoryHandle.removeEntry(name, { recursive: false });
      if (syncDir) {
        await result;
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      return VFS.SQLITE_IOERR_DELETE;
    }
  }

  async jAccess(zName: string, flags: number, pResOut: DataView): Promise<number> {
    try {
      const url = new URL(zName, 'file://');
      const pathname = url.pathname;

      const [directoryHandle, dbName] = await getPathComponents(pathname, false);
      await directoryHandle.getFileHandle(dbName, { create: false });
      pResOut.setInt32(0, 1, true);
      return VFS.SQLITE_OK;
    } catch (e: any) {
      if (e.name === 'NotFoundError') {
        pResOut.setInt32(0, 0, true);
        return VFS.SQLITE_OK;
      }
      this.lastError = e;
      return VFS.SQLITE_IOERR_ACCESS;
    }
  }

  async jClose(fileId: number): Promise<number> {
    try {
      const file = this.mapIdToFile.get(fileId);
      this.mapIdToFile.delete(fileId);
      await file?.accessHandle?.close();

      if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        const [directoryHandle, name] = await getPathComponents(file.pathname, false);
        await directoryHandle.removeEntry(name, { recursive: false });
      }
      return VFS.SQLITE_OK;
    } catch (e) {
      return VFS.SQLITE_IOERR_DELETE;
    }
  }

  jRead(fileId: number, pData: Uint8Array, iOffset: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);

      const bytesRead = file.accessHandle.read(pData.subarray(), { at: iOffset });
      if (file.openLockReleaser) {
        file.accessHandle.close();
        file.accessHandle = null;
        file.openLockReleaser();
        file.openLockReleaser = null;
        this.log?.('access handle released for open');
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

      file.accessHandle.write(pData.subarray(), { at: iOffset });
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_WRITE;
    }
  }

  jTruncate(fileId: number, iSize: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      file.accessHandle.truncate(iSize);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_TRUNCATE;
    }
  }

  jSync(fileId: number, flags: number): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      file.accessHandle.flush();
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSYNC;
    }
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    try {
      const file = this.mapIdToFile.get(fileId);
      const size = file.accessHandle.getSize();
      pSize64.setBigInt64(0, BigInt(size), true);
      return VFS.SQLITE_OK;
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR_FSTAT;
    }
  }

  async jLock(fileId: number, lockType: number): Promise<number> {
    if (hasUnsafeAccessHandle) return super.jLock(fileId, lockType);

    const file = this.mapIdToFile.get(fileId);
    if (!file.isFileLocked) {
      file.isFileLocked = true;
      if (!file.handleLockReleaser) {
        file.handleRequestChannel.onmessage = event => {
          if (!file.isFileLocked) {
            file.accessHandle.close();
            file.accessHandle = null;
            file.handleLockReleaser();
            file.handleLockReleaser = null;
            this.log?.('access handle requested and released');
          } else {
            file.isHandleRequested = true;
            this.log?.('access handle requested');
          }
          file.handleRequestChannel.onmessage = null;
        };

        file.handleLockReleaser = await new Promise((resolve, reject) => {
          function notify() {
            file.handleRequestChannel.postMessage(null);
          }
          const notifyId = setInterval(notify, LOCK_NOTIFY_INTERVAL);
          setTimeout(notify);

          navigator.locks.request(this.getFilename(fileId), lock => {
            clearInterval(notifyId);
            if (!lock) return reject();
            return new Promise(release => {
              resolve(release as () => void);
            });
          });
        });

        file.accessHandle = await file.fileHandle.createSyncAccessHandle();
        this.log?.('access handle acquired');
      }
    }
    return VFS.SQLITE_OK;
  }

  async jUnlock(fileId: number, lockType: number): Promise<number> {
    if (hasUnsafeAccessHandle) return super.jUnlock(fileId, lockType);

    if (lockType === VFS.SQLITE_LOCK_NONE) {
      const file = this.mapIdToFile.get(fileId);
      if (file.isHandleRequested) {
        if (file.handleLockReleaser) {
          file.accessHandle.close();
          file.accessHandle = null;
          file.handleLockReleaser();
          file.handleLockReleaser = null;
          this.log?.('access handle released');
        }
        file.isHandleRequested = false;
      }
      file.isFileLocked = false;
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
          this.log?.('xFileControl', file.pathname, 'PRAGMA', key, value);
          switch (key.toLowerCase()) {
            case 'journal_mode':
              if (value &&
                  !hasUnsafeAccessHandle &&
                  !['off', 'memory', 'delete', 'wal'].includes(value.toLowerCase())) {
                throw new Error('journal_mode must be "off", "memory", "delete", or "wal"');
              }
              break;
            case 'write_hint':
              return super.jFileControl(fileId, WebLocksMixin.WRITE_HINT_OP_CODE, null);
          }
          break;
      }
    } catch (e) {
      this.lastError = e;
      return VFS.SQLITE_IOERR;
    }
    return super.jFileControl(fileId, op, pArg);
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
