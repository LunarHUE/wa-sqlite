// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';
import { WebLocksMixin } from '../WebLocksMixin';
async function getPathComponents(pathname, create) {
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
    pathname;
    flags;
    fileHandle;
    blob = null;
    writable = null;
    constructor(pathname, flags) {
        this.pathname = pathname;
        this.flags = flags;
    }
}
export class OPFSAnyContextVFS extends WebLocksMixin(FacadeVFS) {
    mapIdToFile = new Map();
    lastError = null;
    log = null;
    static async create(name, module, options) {
        const vfs = new OPFSAnyContextVFS(name, module, options);
        await vfs.isReady();
        return vfs;
    }
    constructor(name, module, options = {}) {
        super(name, module, options);
    }
    getFilename(fileId) {
        const pathname = this.mapIdToFile.get(fileId).pathname;
        return `OPFS:${pathname}`;
    }
    async jOpen(zName, fileId, flags, pOutFlags) {
        try {
            const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
            const pathname = url.pathname;
            const file = new File(pathname, flags);
            this.mapIdToFile.set(fileId, file);
            const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
            const [directoryHandle, filename] = await getPathComponents(pathname, create);
            file.fileHandle = await directoryHandle.getFileHandle(filename, { create });
            pOutFlags.setInt32(0, flags, true);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.lastError = e;
            return VFS.SQLITE_CANTOPEN;
        }
    }
    async jDelete(zName, syncDir) {
        try {
            const url = new URL(zName, 'file://');
            const pathname = url.pathname;
            const [directoryHandle, name] = await getPathComponents(pathname, false);
            const result = directoryHandle.removeEntry(name, { recursive: false });
            if (syncDir) {
                await result;
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            return VFS.SQLITE_IOERR_DELETE;
        }
    }
    async jAccess(zName, flags, pResOut) {
        try {
            const url = new URL(zName, 'file://');
            const pathname = url.pathname;
            const [directoryHandle, dbName] = await getPathComponents(pathname, false);
            await directoryHandle.getFileHandle(dbName, { create: false });
            pResOut.setInt32(0, 1, true);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            if (e.name === 'NotFoundError') {
                pResOut.setInt32(0, 0, true);
                return VFS.SQLITE_OK;
            }
            this.lastError = e;
            return VFS.SQLITE_IOERR_ACCESS;
        }
    }
    async jClose(fileId) {
        try {
            const file = this.mapIdToFile.get(fileId);
            this.mapIdToFile.delete(fileId);
            await file.writable?.close();
            if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
                const [directoryHandle, name] = await getPathComponents(file.pathname, false);
                await directoryHandle.removeEntry(name, { recursive: false });
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            return VFS.SQLITE_IOERR_DELETE;
        }
    }
    async jRead(fileId, pData, iOffset) {
        try {
            const file = this.mapIdToFile.get(fileId);
            if (file.writable) {
                await file.writable.close();
                file.writable = null;
                file.blob = null;
            }
            if (!file.blob) {
                file.blob = await file.fileHandle.getFile();
            }
            const bytesRead = await file.blob.slice(iOffset, iOffset + pData.byteLength)
                .arrayBuffer()
                .then(arrayBuffer => {
                pData.set(new Uint8Array(arrayBuffer));
                return arrayBuffer.byteLength;
            });
            if (bytesRead < pData.byteLength) {
                pData.fill(0, bytesRead);
                return VFS.SQLITE_IOERR_SHORT_READ;
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.lastError = e;
            return VFS.SQLITE_IOERR_READ;
        }
    }
    async jWrite(fileId, pData, iOffset) {
        try {
            const file = this.mapIdToFile.get(fileId);
            if (!file.writable) {
                file.writable = await file.fileHandle.createWritable({ keepExistingData: true });
            }
            await file.writable.seek(iOffset);
            await file.writable.write(pData.subarray());
            file.blob = null;
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.lastError = e;
            return VFS.SQLITE_IOERR_WRITE;
        }
    }
    async jTruncate(fileId, iSize) {
        try {
            const file = this.mapIdToFile.get(fileId);
            if (!file.writable) {
                file.writable = await file.fileHandle.createWritable({ keepExistingData: true });
            }
            await file.writable.truncate(iSize);
            file.blob = null;
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.lastError = e;
            return VFS.SQLITE_IOERR_TRUNCATE;
        }
    }
    async jSync(fileId, flags) {
        try {
            const file = this.mapIdToFile.get(fileId);
            await file.writable?.close();
            file.writable = null;
            file.blob = null;
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.lastError = e;
            return VFS.SQLITE_IOERR_FSYNC;
        }
    }
    async jFileSize(fileId, pSize64) {
        try {
            const file = this.mapIdToFile.get(fileId);
            if (file.writable) {
                await file.writable.close();
                file.writable = null;
                file.blob = null;
            }
            if (!file.blob) {
                file.blob = await file.fileHandle.getFile();
            }
            pSize64.setBigInt64(0, BigInt(file.blob.size), true);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.lastError = e;
            return VFS.SQLITE_IOERR_FSTAT;
        }
    }
    async jLock(fileId, lockType) {
        if (lockType === VFS.SQLITE_LOCK_SHARED) {
            const file = this.mapIdToFile.get(fileId);
            file.blob = null;
        }
        return super.jLock(fileId, lockType);
    }
    jGetLastError(zBuf) {
        if (this.lastError) {
            console.error(this.lastError);
            const outputArray = zBuf.subarray(0, zBuf.byteLength - 1);
            const { written } = new TextEncoder().encodeInto(this.lastError.message, outputArray);
            zBuf[written] = 0;
        }
        return VFS.SQLITE_OK;
    }
}
