// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';

interface MemoryFile {
  pathname: string;
  flags: number;
  size: number;
  data: ArrayBuffer;
}

// Sample in-memory filesystem.
export class MemoryVFS extends FacadeVFS {
  mapNameToFile: Map<string, MemoryFile> = new Map();
  mapIdToFile: Map<number, MemoryFile> = new Map();

  static async create(name: string, module: any): Promise<MemoryVFS> {
    const vfs = new MemoryVFS(name, module);
    await vfs.isReady();
    return vfs;
  }

  constructor(name: string, module: any) {
    super(name, module);
  }

  close(): void {
    for (const fileId of this.mapIdToFile.keys()) {
      this.jClose(fileId);
    }
  }

  jOpen(filename: string | null, fileId: number, flags: number, pOutFlags: DataView): number | Promise<number> {
    const url = new URL(filename || Math.random().toString(36).slice(2), 'file://');
    const pathname = url.pathname;

    let file = this.mapNameToFile.get(pathname);
    if (!file) {
      if (flags & VFS.SQLITE_OPEN_CREATE) {
        file = {
          pathname,
          flags,
          size: 0,
          data: new ArrayBuffer(0)
        };
        this.mapNameToFile.set(pathname, file);
      } else {
        return VFS.SQLITE_CANTOPEN;
      }
    }

    this.mapIdToFile.set(fileId, file);
    pOutFlags.setInt32(0, flags, true);
    return VFS.SQLITE_OK;
  }

  jClose(fileId: number): number | Promise<number> {
    const file = this.mapIdToFile.get(fileId);
    this.mapIdToFile.delete(fileId);

    if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
      this.mapNameToFile.delete(file.pathname);
    }
    return VFS.SQLITE_OK;
  }

  jRead(fileId: number, pData: Uint8Array, iOffset: number): number | Promise<number> {
    const file = this.mapIdToFile.get(fileId);

    const bgn = Math.min(iOffset, file.size);
    const end = Math.min(iOffset + pData.byteLength, file.size);
    const nBytes = end - bgn;

    if (nBytes) {
      pData.set(new Uint8Array(file.data, bgn, nBytes));
    }

    if (nBytes < pData.byteLength) {
      pData.fill(0, nBytes);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }
    return VFS.SQLITE_OK;
  }

  jWrite(fileId: number, pData: Uint8Array, iOffset: number): number | Promise<number> {
    const file = this.mapIdToFile.get(fileId);
    if (iOffset + pData.byteLength > file.data.byteLength) {
      const newSize = Math.max(iOffset + pData.byteLength, 2 * file.data.byteLength);
      const data = new ArrayBuffer(newSize);
      new Uint8Array(data).set(new Uint8Array(file.data, 0, file.size));
      file.data = data;
    }

    new Uint8Array(file.data, iOffset, pData.byteLength).set(pData.subarray());
    file.size = Math.max(file.size, iOffset + pData.byteLength);
    return VFS.SQLITE_OK;
  }

  jTruncate(fileId: number, iSize: number): number | Promise<number> {
    const file = this.mapIdToFile.get(fileId);
    file.size = Math.min(file.size, iSize);
    return VFS.SQLITE_OK;
  }

  jFileSize(fileId: number, pSize64: DataView): number | Promise<number> {
    const file = this.mapIdToFile.get(fileId);
    pSize64.setBigInt64(0, BigInt(file.size), true);
    return VFS.SQLITE_OK;
  }

  jDelete(name: string, syncDir: number): number | Promise<number> {
    const url = new URL(name, 'file://');
    const pathname = url.pathname;
    this.mapNameToFile.delete(pathname);
    return VFS.SQLITE_OK;
  }

  jAccess(name: string, flags: number, pResOut: DataView): number | Promise<number> {
    const url = new URL(name, 'file://');
    const pathname = url.pathname;
    const file = this.mapNameToFile.get(pathname);
    pResOut.setInt32(0, file ? 1 : 0, true);
    return VFS.SQLITE_OK;
  }
}
