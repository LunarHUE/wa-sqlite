// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';
import { WebLocksMixin } from '../WebLocksMixin';
const SHARED = { mode: 'shared' };
const POLL_SHARED = { ifAvailable: true, mode: 'shared' };
const POLL_EXCLUSIVE = { ifAvailable: true, mode: 'exclusive' };
const DEFAULT_FLUSH_INTERVAL = 64;
const contextId = Math.random().toString(36).slice(2);
async function getPathComponents(path, create) {
    const components = path.split('/');
    const filename = components.pop();
    let directory = await navigator.storage.getDirectory();
    for (const component of components.filter(s => s)) {
        directory = await directory.getDirectoryHandle(component, { create });
    }
    return [directory, filename];
}
class File {
    path;
    flags;
    accessHandle;
    pageSize;
    fileSize;
    idb;
    viewTx;
    viewReleaser;
    broadcastChannel;
    broadcastReceived;
    mapPageToOffset;
    mapTxToPending;
    freeOffsets;
    lockState;
    locks;
    abortController;
    txActive;
    txRealFileSize;
    txIsOverwrite;
    txWriteHint;
    synchronous;
    flushInterval;
    constructor(pathname, flags) {
        this.path = pathname;
        this.flags = flags;
    }
    static async create(pathname, flags) {
        const file = new File(pathname, flags);
        const create = !!(flags & VFS.SQLITE_OPEN_CREATE);
        const [directory, filename] = await getPathComponents(pathname, create);
        const handle = await directory.getFileHandle(filename, { create });
        // @ts-ignore
        file.accessHandle = await handle.createSyncAccessHandle({ mode: 'readwrite-unsafe' });
        if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
            file.idb = await new Promise((resolve, reject) => {
                const request = indexedDB.open(pathname);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    db.createObjectStore('pages', { keyPath: 'i' });
                    db.createObjectStore('pending', { keyPath: 'txId' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return file;
    }
}
export class OPFSPermutedVFS extends FacadeVFS {
    #mapIdToFile = new Map();
    #lastError = null;
    log = null;
    static async create(name, module) {
        const vfs = new OPFSPermutedVFS(name, module);
        await vfs.isReady();
        return vfs;
    }
    async jOpen(zName, fileId, flags, pOutFlags) {
        const onFinally = [];
        try {
            const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
            const path = url.pathname;
            const file = await File.create(path, flags);
            if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
                file.pageSize = 0;
                file.fileSize = 0;
                file.viewTx = { txId: 0 };
                file.broadcastChannel = new BroadcastChannel(`permuted:${path}`);
                file.broadcastReceived = [];
                file.mapPageToOffset = new Map();
                file.mapTxToPending = new Map();
                file.freeOffsets = new Set();
                file.lockState = VFS.SQLITE_LOCK_NONE;
                file.locks = {};
                file.abortController = new AbortController();
                file.txIsOverwrite = false;
                file.txActive = null;
                file.synchronous = 'full';
                file.flushInterval = DEFAULT_FLUSH_INTERVAL;
                await this.#lock(file, 'write');
                onFinally.push(() => file.locks.write());
                const tx = file.idb.transaction(['pages', 'pending']);
                const pages = await idbX(tx.objectStore('pages').getAll());
                file.pageSize = this.#getPageSize(file);
                file.fileSize = pages.length * file.pageSize;
                const opfsFileSize = file.accessHandle.getSize();
                for (let i = 0; i < opfsFileSize; i += file.pageSize) {
                    file.freeOffsets.add(i);
                }
                for (const { i, o } of pages) {
                    file.mapPageToOffset.set(i, o);
                    file.freeOffsets.delete(o);
                }
                try {
                    const transactions = await idbX(tx.objectStore('pending').getAll());
                    for (const transaction of transactions) {
                        for (const [index, { offset, digest }] of transaction.pages) {
                            const data = new Uint8Array(file.pageSize);
                            file.accessHandle.read(data, { at: offset });
                            if (checksum(data).some((v, i) => v !== digest[i])) {
                                throw Object.assign(new Error('checksum error'), { txId: transaction.txId });
                            }
                        }
                        this.#acceptTx(file, transaction);
                        file.viewTx = transaction;
                    }
                }
                catch (e) {
                    if (e.message === 'checksum error') {
                        console.warn(`Checksum error, removing tx ${e.txId}+`);
                        const tx = file.idb.transaction('pending', 'readwrite');
                        const txCommit = new Promise((resolve, reject) => {
                            tx.oncomplete = resolve;
                            tx.onabort = () => reject(tx.error);
                        });
                        const range = IDBKeyRange.lowerBound(e.txId);
                        tx.objectStore('pending').delete(range);
                        tx.commit();
                        await txCommit;
                    }
                    else {
                        throw e;
                    }
                }
                await this.#setView(file, file.viewTx);
                file.broadcastChannel.addEventListener('message', event => {
                    file.broadcastReceived.push(event.data);
                    if (file.lockState === VFS.SQLITE_LOCK_NONE) {
                        this.#processBroadcasts(file);
                    }
                });
                await this.#lock(file, 'read', SHARED);
            }
            pOutFlags.setInt32(0, flags, true);
            this.#mapIdToFile.set(fileId, file);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_CANTOPEN;
        }
        finally {
            while (onFinally.length) {
                await onFinally.pop()();
            }
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
            this.#lastError = e;
            return VFS.SQLITE_IOERR_ACCESS;
        }
    }
    async jClose(fileId) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            this.#mapIdToFile.delete(fileId);
            file?.accessHandle?.close();
            if (file?.flags & VFS.SQLITE_OPEN_MAIN_DB) {
                file.broadcastChannel.close();
                file.viewReleaser?.();
            }
            if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
                const [directoryHandle, name] = await getPathComponents(file.path, false);
                await directoryHandle.removeEntry(name, { recursive: false });
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            return VFS.SQLITE_IOERR_CLOSE;
        }
    }
    jRead(fileId, pData, iOffset) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            let bytesRead = 0;
            if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
                file.abortController.signal.throwIfAborted();
                const pageIndex = file.pageSize ?
                    Math.trunc(iOffset / file.pageSize) + 1 :
                    1;
                const pageOffset = file.txActive?.pages.has(pageIndex) ?
                    file.txActive.pages.get(pageIndex).offset :
                    file.mapPageToOffset.get(pageIndex);
                if (pageOffset >= 0) {
                    this.log?.(`read page ${pageIndex} at ${pageOffset}`);
                    bytesRead = file.accessHandle.read(pData.subarray(), { at: pageOffset + (file.pageSize ? iOffset % file.pageSize : 0) });
                }
                if (!file.pageSize && iOffset <= 16 && iOffset + bytesRead >= 18) {
                    const dataView = new DataView(pData.slice(16 - iOffset, 18 - iOffset).buffer);
                    file.pageSize = dataView.getUint16(0);
                    if (file.pageSize === 1) {
                        file.pageSize = 65536;
                    }
                    this.log?.(`set page size ${file.pageSize}`);
                }
            }
            else {
                bytesRead = file.accessHandle.read(pData.subarray(), { at: iOffset });
            }
            if (bytesRead < pData.byteLength) {
                pData.fill(0, bytesRead);
                return VFS.SQLITE_IOERR_SHORT_READ;
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_IOERR_READ;
        }
    }
    jWrite(fileId, pData, iOffset) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
                file.abortController.signal.throwIfAborted();
                if (!file.pageSize) {
                    this.log?.(`set page size ${pData.byteLength}`);
                    file.pageSize = pData.byteLength;
                }
                if (!file.txActive) {
                    this.#beginTx(file);
                }
                let pageOffset;
                const pageIndex = Math.trunc(iOffset / file.pageSize) + 1;
                if (file.txIsOverwrite) {
                    pageOffset = iOffset;
                }
                else if (file.txActive.pages.has(pageIndex)) {
                    pageOffset = file.txActive.pages.get(pageIndex).offset;
                    this.log?.(`overwrite page ${pageIndex} at ${pageOffset}`);
                }
                else if (pageIndex === 1 && file.freeOffsets.delete(0)) {
                    pageOffset = 0;
                    this.log?.(`write page ${pageIndex} at ${pageOffset}`);
                }
                else {
                    for (const maybeOffset of file.freeOffsets) {
                        if (maybeOffset) {
                            if (maybeOffset < file.txRealFileSize) {
                                pageOffset = maybeOffset;
                                file.freeOffsets.delete(pageOffset);
                                this.log?.(`write page ${pageIndex} at ${pageOffset}`);
                                break;
                            }
                            else {
                                file.freeOffsets.delete(maybeOffset);
                            }
                        }
                    }
                    if (pageOffset === undefined) {
                        pageOffset = file.txRealFileSize;
                        this.log?.(`append page ${pageIndex} at ${pageOffset}`);
                    }
                }
                file.accessHandle.write(pData.subarray(), { at: pageOffset });
                file.txActive.pages.set(pageIndex, {
                    offset: pageOffset,
                    digest: checksum(pData.subarray())
                });
                file.txActive.fileSize = Math.max(file.txActive.fileSize, pageIndex * file.pageSize);
                file.txRealFileSize = Math.max(file.txRealFileSize, pageOffset + pData.byteLength);
            }
            else {
                file.accessHandle.write(pData.subarray(), { at: iOffset });
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_IOERR_WRITE;
        }
    }
    jTruncate(fileId, iSize) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            if ((file.flags & VFS.SQLITE_OPEN_MAIN_DB) && !file.txIsOverwrite) {
                file.abortController.signal.throwIfAborted();
                if (!file.txActive) {
                    this.#beginTx(file);
                }
                file.txActive.fileSize = iSize;
                for (const [index, { offset }] of file.txActive.pages) {
                    if (index * file.pageSize > iSize) {
                        file.txActive.pages.delete(index);
                        file.freeOffsets.add(offset);
                    }
                }
                return VFS.SQLITE_OK;
            }
            file.accessHandle.truncate(iSize);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            console.error(e);
            this.lastError = e;
            return VFS.SQLITE_IOERR_TRUNCATE;
        }
    }
    jSync(fileId, flags) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            if (!(file.flags & VFS.SQLITE_OPEN_MAIN_DB)) {
                file.accessHandle.flush();
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_IOERR_FSYNC;
        }
    }
    jFileSize(fileId, pSize64) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            let size;
            if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
                file.abortController.signal.throwIfAborted();
                size = file.txActive?.fileSize ?? file.fileSize;
            }
            else {
                size = file.accessHandle.getSize();
            }
            pSize64.setBigInt64(0, BigInt(size), true);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_IOERR_FSTAT;
        }
    }
    async jLock(fileId, lockType) {
        const file = this.#mapIdToFile.get(fileId);
        if (lockType <= file.lockState)
            return VFS.SQLITE_OK;
        switch (lockType) {
            case VFS.SQLITE_LOCK_SHARED:
                if (file.txWriteHint) {
                    if (!await this.#lock(file, 'hint')) {
                        return VFS.SQLITE_BUSY;
                    }
                }
                if (!file.locks.read) {
                    await this.#lock(file, 'read', SHARED);
                }
                break;
            case VFS.SQLITE_LOCK_RESERVED:
                if (!file.locks.hint && !await this.#lock(file, 'hint', POLL_EXCLUSIVE)) {
                    return VFS.SQLITE_BUSY;
                }
                if (!await this.#lock(file, 'reserved', POLL_EXCLUSIVE)) {
                    file.locks.hint();
                    return VFS.SQLITE_BUSY;
                }
                const tx = file.idb.transaction(['pending']);
                const range = IDBKeyRange.lowerBound(file.viewTx.txId);
                const entries = await idbX(tx.objectStore('pending').getAll(range));
                if (entries.length && entries.at(-1).txId > file.viewTx.txId) {
                    file.broadcastReceived.push(...entries);
                    file.locks.reserved();
                    return VFS.SQLITE_BUSY;
                }
                break;
            case VFS.SQLITE_LOCK_EXCLUSIVE:
                await this.#lock(file, 'write');
                break;
        }
        file.lockState = lockType;
        return VFS.SQLITE_OK;
    }
    jUnlock(fileId, lockType) {
        const file = this.#mapIdToFile.get(fileId);
        if (lockType >= file.lockState)
            return VFS.SQLITE_OK;
        switch (lockType) {
            case VFS.SQLITE_LOCK_SHARED:
                file.locks.write?.();
                file.locks.reserved?.();
                file.locks.hint?.();
                break;
            case VFS.SQLITE_LOCK_NONE:
                this.#processBroadcasts(file);
                file.locks.write?.();
                file.locks.reserved?.();
                file.locks.hint?.();
                break;
        }
        file.lockState = lockType;
        return VFS.SQLITE_OK;
    }
    async jCheckReservedLock(fileId, pResOut) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            if (await this.#lock(file, 'reserved', POLL_SHARED)) {
                pResOut.setInt32(0, 0, true);
                file.locks.reserved();
            }
            else {
                pResOut.setInt32(0, 1, true);
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            console.error(e);
            this.lastError = e;
            return VFS.SQLITE_IOERR_LOCK;
        }
    }
    async jFileControl(fileId, op, pArg) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            switch (op) {
                case VFS.SQLITE_FCNTL_PRAGMA:
                    const key = cvtString(pArg, 4);
                    const value = cvtString(pArg, 8);
                    this.log?.('xFileControl', file.path, 'PRAGMA', key, value);
                    switch (key.toLowerCase()) {
                        case 'page_size':
                            if (value && file.pageSize && Number(value) !== file.pageSize) {
                                return VFS.SQLITE_ERROR;
                            }
                            break;
                        case 'synchronous':
                            if (value) {
                                switch (value.toLowerCase()) {
                                    case 'full':
                                    case '2':
                                    case 'extra':
                                    case '3':
                                        file.synchronous = 'full';
                                        break;
                                    default:
                                        file.synchronous = 'normal';
                                        break;
                                }
                            }
                            break;
                        case 'flush_interval':
                            if (value) {
                                const interval = Number(value);
                                if (interval > 0) {
                                    file.flushInterval = Number(value);
                                }
                                else {
                                    return VFS.SQLITE_ERROR;
                                }
                            }
                            else {
                                const buffer = new TextEncoder().encode(file.flushInterval.toString());
                                const s = this._module._sqlite3_malloc64(buffer.byteLength + 1);
                                new Uint8Array(this._module.HEAPU8.buffer, s, buffer.byteLength + 1)
                                    .fill(0)
                                    .set(buffer);
                                pArg.setUint32(0, s, true);
                                return VFS.SQLITE_OK;
                            }
                            break;
                        case 'write_hint':
                            return this.jFileControl(fileId, WebLocksMixin.WRITE_HINT_OP_CODE, null);
                    }
                    break;
                case VFS.SQLITE_FCNTL_BEGIN_ATOMIC_WRITE:
                    this.log?.('xFileControl', 'BEGIN_ATOMIC_WRITE', file.path);
                    return VFS.SQLITE_OK;
                case VFS.SQLITE_FCNTL_COMMIT_ATOMIC_WRITE:
                    this.log?.('xFileControl', 'COMMIT_ATOMIC_WRITE', file.path);
                    return VFS.SQLITE_OK;
                case VFS.SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE:
                    this.log?.('xFileControl', 'ROLLBACK_ATOMIC_WRITE', file.path);
                    this.#rollbackTx(file);
                    return VFS.SQLITE_OK;
                case VFS.SQLITE_FCNTL_OVERWRITE:
                    this.log?.('xFileControl', 'OVERWRITE', file.path);
                    await this.#prepareOverwrite(file);
                    break;
                case VFS.SQLITE_FCNTL_COMMIT_PHASETWO:
                    this.log?.('xFileControl', 'COMMIT_PHASETWO', file.path);
                    if (file.txActive) {
                        await this.#commitTx(file);
                    }
                    break;
                case WebLocksMixin.WRITE_HINT_OP_CODE:
                    file.txWriteHint = true;
                    break;
            }
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_IOERR;
        }
        return VFS.SQLITE_NOTFOUND;
    }
    jDeviceCharacteristics(fileId) {
        return 0
            | VFS.SQLITE_IOCAP_BATCH_ATOMIC
            | VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
    }
    jGetLastError(zBuf) {
        if (this.#lastError) {
            console.error(this.#lastError);
            const outputArray = zBuf.subarray(0, zBuf.byteLength - 1);
            const { written } = new TextEncoder().encodeInto(this.#lastError.message, outputArray);
            zBuf[written] = 0;
        }
        return VFS.SQLITE_OK;
    }
    #getPageSize(file) {
        const header = new DataView(new ArrayBuffer(2));
        const n = file.accessHandle.read(header, { at: 16 });
        if (n !== header.byteLength)
            return 0;
        const pageSize = header.getUint16(0);
        switch (pageSize) {
            case 1:
                return 65536;
            default:
                return pageSize;
        }
    }
    #lock(file, name, options = {}) {
        return new Promise(resolve => {
            const lockName = `${file.path}@@${name}`;
            navigator.locks.request(lockName, options, lock => {
                if (lock) {
                    return new Promise(release => {
                        file.locks[name] = () => {
                            release();
                            file.locks[name] = null;
                        };
                        resolve(true);
                    });
                }
                else {
                    file.locks[name] = null;
                    resolve(false);
                }
            }).catch(e => {
                if (e.name !== 'AbortError')
                    throw e;
            });
        });
    }
    async #setView(file, tx) {
        file.viewTx = tx;
        const lockName = `${file.path}@@[${tx.txId}]`;
        const newReleaser = await new Promise(resolve => {
            navigator.locks.request(lockName, SHARED, lock => {
                return new Promise(release => {
                    resolve(release);
                });
            });
        });
        file.viewReleaser?.();
        file.viewReleaser = newReleaser;
    }
    #processBroadcasts(file) {
        // @ts-ignore
        file.broadcastReceived.sort((a, b) => (a.txId ?? -1) - (b.txId ?? -1));
        let nHandled = 0;
        let newTx = file.viewTx;
        for (const message of file.broadcastReceived) {
            if (Object.hasOwn(message, 'txId')) {
                const messageTx = message;
                if (messageTx.txId <= newTx.txId) {
                    // already incorporated
                }
                else if (messageTx.txId === newTx.txId + 1) {
                    this.log?.(`accept tx ${messageTx.txId}`);
                    this.#acceptTx(file, messageTx);
                    newTx = messageTx;
                }
                else {
                    console.warn(`missing tx ${newTx.txId + 1} (got ${messageTx.txId})`);
                    break;
                }
            }
            else if (Object.hasOwn(message, 'exclusive')) {
                this.log?.('releasing read lock');
                console.assert(file.lockState === VFS.SQLITE_LOCK_NONE);
                file.locks.read?.();
            }
            nHandled++;
        }
        file.broadcastReceived.splice(0, nHandled);
        if (newTx.txId > file.viewTx.txId) {
            this.#setView(file, newTx);
        }
    }
    #acceptTx(file, message) {
        file.pageSize = file.pageSize || this.#getPageSize(file);
        message.reclaimable = [];
        for (const [index, { offset }] of message.pages) {
            if (file.mapPageToOffset.has(index)) {
                message.reclaimable.push(file.mapPageToOffset.get(index));
            }
            file.mapPageToOffset.set(index, offset);
            file.freeOffsets.delete(offset);
        }
        const oldPageCount = file.fileSize / file.pageSize;
        const newPageCount = message.fileSize / file.pageSize;
        for (let index = newPageCount + 1; index <= oldPageCount; index++) {
            message.reclaimable.push(file.mapPageToOffset.get(index));
            file.mapPageToOffset.delete(index);
        }
        file.fileSize = message.fileSize;
        file.mapTxToPending.set(message.txId, message);
        if (message.oldestTxId) {
            for (const tx of file.mapTxToPending.values()) {
                if (tx.txId > message.oldestTxId)
                    break;
                for (const offset of tx.reclaimable) {
                    this.log?.(`reclaim offset ${offset}`);
                    file.freeOffsets.add(offset);
                }
                file.mapTxToPending.delete(tx.txId);
            }
        }
    }
    #beginTx(file) {
        file.txActive = {
            txId: file.viewTx.txId + 1,
            pages: new Map(),
            fileSize: file.fileSize
        };
        file.txRealFileSize = file.accessHandle.getSize();
        this.log?.(`begin transaction ${file.txActive.txId}`);
    }
    async #commitTx(file) {
        if (file.synchronous === 'full' ||
            file.txIsOverwrite ||
            (file.txActive.txId % file.flushInterval) === 0) {
            file.txActive.oldestTxId = await this.#getOldestTxInUse(file);
        }
        const tx = file.idb.transaction(['pages', 'pending'], 'readwrite', { durability: file.synchronous === 'full' ? 'strict' : 'relaxed' });
        if (file.txActive.oldestTxId) {
            if (file.txIsOverwrite) {
                file.accessHandle.truncate(file.txActive.fileSize);
            }
            file.accessHandle.flush();
            const pageStore = tx.objectStore('pages');
            for (const tx of file.mapTxToPending.values()) {
                if (tx.txId > file.txActive.oldestTxId)
                    break;
                for (const [index, { offset }] of tx.pages) {
                    pageStore.put({ i: index, o: offset });
                }
            }
            tx.objectStore('pending')
                .delete(IDBKeyRange.upperBound(file.txActive.oldestTxId));
        }
        this.log?.(`commit transaction ${file.txActive.txId}`);
        tx.objectStore('pending').put(file.txActive);
        const txComplete = new Promise((resolve, reject) => {
            const message = file.txActive;
            tx.oncomplete = () => {
                file.broadcastChannel.postMessage(message);
                resolve();
            };
            tx.onabort = () => {
                file.abortController.abort();
                reject(tx.error);
            };
            tx.commit();
        });
        if (file.synchronous === 'full') {
            await txComplete;
        }
        this.#acceptTx(file, file.txActive);
        this.#setView(file, file.txActive);
        file.txActive = null;
        file.txWriteHint = false;
        if (file.txIsOverwrite) {
            while (file.viewTx.txId !== await this.#getOldestTxInUse(file)) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            file.locks.read();
            await this.#lock(file, 'read', SHARED);
            file.freeOffsets.clear();
            file.txIsOverwrite = false;
        }
    }
    #rollbackTx(file) {
        this.log?.(`rollback transaction ${file.txActive.txId}`);
        for (const { offset } of file.txActive.pages.values()) {
            file.freeOffsets.add(offset);
        }
        file.txActive = null;
        file.txWriteHint = false;
    }
    async #prepareOverwrite(file) {
        file.locks.read?.();
        if (!await this.#lock(file, 'read', POLL_EXCLUSIVE)) {
            const lockRequest = this.#lock(file, 'read');
            file.broadcastChannel.postMessage({ exclusive: true });
            await lockRequest;
        }
        file.txActive = {
            txId: file.viewTx.txId + 1,
            pages: new Map(),
            fileSize: file.fileSize
        };
        const offsetGenerator = (function* () {
            for (const offset of file.freeOffsets) {
                if (offset >= file.fileSize) {
                    yield offset;
                }
            }
            while (true) {
                yield file.accessHandle.getSize();
            }
        })();
        const pageBuffer = new Uint8Array(file.pageSize);
        for (let offset = 0; offset < file.fileSize; offset += file.pageSize) {
            const pageIndex = offset / file.pageSize + 1;
            const oldOffset = file.mapPageToOffset.get(pageIndex);
            if (oldOffset < file.fileSize) {
                if (file.accessHandle.read(pageBuffer, { at: oldOffset }) !== file.pageSize) {
                    throw new Error('Failed to read page');
                }
                const newOffset = offsetGenerator.next().value;
                if (file.accessHandle.write(pageBuffer, { at: newOffset }) !== file.pageSize) {
                    throw new Error('Failed to write page');
                }
                file.txActive.pages.set(pageIndex, {
                    offset: newOffset,
                    digest: checksum(pageBuffer)
                });
            }
        }
        file.accessHandle.flush();
        file.freeOffsets.clear();
        file.broadcastChannel.postMessage(file.txActive);
        const tx = file.idb.transaction('pending', 'readwrite');
        const txComplete = new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
        });
        tx.objectStore('pending').put(file.txActive);
        tx.commit();
        await txComplete;
        this.#acceptTx(file, file.txActive);
        this.#setView(file, file.txActive);
        file.txActive = null;
        file.txIsOverwrite = true;
    }
    async #getOldestTxInUse(file) {
        const TX_LOCK_REGEX = /^(.*)@@\[(\d+)\]$/;
        let oldestTxId = file.viewTx.txId;
        const locks = await navigator.locks.query();
        for (const { name } of locks.held) {
            const m = TX_LOCK_REGEX.exec(name);
            if (m && m[1] === file.path) {
                oldestTxId = Math.min(oldestTxId, Number(m[2]));
            }
        }
        return oldestTxId;
    }
}
function idbX(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
function cvtString(dataView, offset) {
    const p = dataView.getUint32(offset, true);
    if (p) {
        const chars = new Uint8Array(dataView.buffer, p);
        return new TextDecoder().decode(chars.subarray(0, chars.indexOf(0)));
    }
    return null;
}
function checksum(data) {
    const array = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / Uint32Array.BYTES_PER_ELEMENT);
    let h1 = 0;
    let h2 = 0;
    for (const value of array) {
        h1 = (h1 + value) % 4294967295;
        h2 = (h2 + h1) % 4294967295;
    }
    return new Uint32Array([h1, h2]);
}
