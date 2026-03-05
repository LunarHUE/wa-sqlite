// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './sqlite-constants';
export * from './sqlite-constants';

const DEFAULT_SECTOR_SIZE = 512;

// Base class for a VFS.
export class Base {
  name: string;
  mxPathname = 64;
  _module: any;

  constructor(name: string, module: any) {
    this.name = name;
    this._module = module;
  }

  close(): void | Promise<void> {
  }

  isReady(): boolean | Promise<boolean> {
    return true;
  }

  hasAsyncMethod(methodName: string): boolean {
    return false;
  }

  xOpen(pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number): number | Promise<number> {
    return VFS.SQLITE_CANTOPEN;
  }

  xDelete(pVfs: number, zName: number, syncDir: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xAccess(pVfs: number, zName: number, flags: number, pResOut: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xFullPathname(pVfs: number, zName: number, nOut: number, zOut: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xGetLastError(pVfs: number, nBuf: number, zBuf: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xClose(pFile: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xRead(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xWrite(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xTruncate(pFile: number, sizeLo: number, sizeHi: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xSync(pFile: number, flags: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xFileSize(pFile: number, pSize: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xLock(pFile: number, lockType: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xUnlock(pFile: number, lockType: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xCheckReservedLock(pFile: number, pResOut: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  xFileControl(pFile: number, op: number, pArg: number): number | Promise<number> {
    return VFS.SQLITE_NOTFOUND;
  }

  xSectorSize(pFile: number): number | Promise<number> {
    return DEFAULT_SECTOR_SIZE;
  }

  xDeviceCharacteristics(pFile: number): number | Promise<number> {
    return 0;
  }
}

export const FILE_TYPE_MASK = [
  VFS.SQLITE_OPEN_MAIN_DB,
  VFS.SQLITE_OPEN_MAIN_JOURNAL,
  VFS.SQLITE_OPEN_TEMP_DB,
  VFS.SQLITE_OPEN_TEMP_JOURNAL,
  VFS.SQLITE_OPEN_TRANSIENT_DB,
  VFS.SQLITE_OPEN_SUBJOURNAL,
  VFS.SQLITE_OPEN_SUPER_JOURNAL,
  VFS.SQLITE_OPEN_WAL
].reduce((mask, element) => mask | element);
