// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './sqlite-constants';
export * from './sqlite-constants';
const DEFAULT_SECTOR_SIZE = 512;
// Base class for a VFS.
export class Base {
    name;
    mxPathname = 64;
    _module;
    constructor(name, module) {
        this.name = name;
        this._module = module;
    }
    close() {
    }
    isReady() {
        return true;
    }
    hasAsyncMethod(methodName) {
        return false;
    }
    xOpen(pVfs, zName, pFile, flags, pOutFlags) {
        return VFS.SQLITE_CANTOPEN;
    }
    xDelete(pVfs, zName, syncDir) {
        return VFS.SQLITE_OK;
    }
    xAccess(pVfs, zName, flags, pResOut) {
        return VFS.SQLITE_OK;
    }
    xFullPathname(pVfs, zName, nOut, zOut) {
        return VFS.SQLITE_OK;
    }
    xGetLastError(pVfs, nBuf, zBuf) {
        return VFS.SQLITE_OK;
    }
    xClose(pFile) {
        return VFS.SQLITE_OK;
    }
    xRead(pFile, pData, iAmt, iOffsetLo, iOffsetHi) {
        return VFS.SQLITE_OK;
    }
    xWrite(pFile, pData, iAmt, iOffsetLo, iOffsetHi) {
        return VFS.SQLITE_OK;
    }
    xTruncate(pFile, sizeLo, sizeHi) {
        return VFS.SQLITE_OK;
    }
    xSync(pFile, flags) {
        return VFS.SQLITE_OK;
    }
    xFileSize(pFile, pSize) {
        return VFS.SQLITE_OK;
    }
    xLock(pFile, lockType) {
        return VFS.SQLITE_OK;
    }
    xUnlock(pFile, lockType) {
        return VFS.SQLITE_OK;
    }
    xCheckReservedLock(pFile, pResOut) {
        return VFS.SQLITE_OK;
    }
    xFileControl(pFile, op, pArg) {
        return VFS.SQLITE_NOTFOUND;
    }
    xSectorSize(pFile) {
        return DEFAULT_SECTOR_SIZE;
    }
    xDeviceCharacteristics(pFile) {
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
