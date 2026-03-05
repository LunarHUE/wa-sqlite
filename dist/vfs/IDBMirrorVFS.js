import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';
const SHARED = { mode: 'shared' };
const POLL_SHARED = { ifAvailable: true, mode: 'shared' };
const POLL_EXCLUSIVE = { ifAvailable: true, mode: 'exclusive' };
const contextId = Math.random().toString(36).slice(2);
class File {
    path;
    flags;
    blockSize;
    blocks;
    viewTx;
    viewReleaser;
    broadcastChannel;
    broadcastReceived;
    lockState;
    locks;
    abortController;
    txActive;
    txWriteHint;
    txOverwrite;
    synchronous;
    constructor(pathname, flags) {
        this.path = pathname;
        this.flags = flags;
        this.blockSize = 0;
        this.blocks = new Map();
        if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
            this.viewTx = null;
            this.viewReleaser = null;
            this.broadcastChannel = new BroadcastChannel('mirror:' + pathname);
            this.broadcastReceived = [];
            this.lockState = VFS.SQLITE_LOCK_NONE;
            this.locks = {};
            this.txActive = null;
            this.txWriteHint = false;
            this.txOverwrite = false;
            this.synchronous = 'full';
        }
    }
}
export class IDBMirrorVFS extends FacadeVFS {
    #mapIdToFile = new Map();
    #mapPathToFile = new Map();
    #lastError = null;
    #idb;
    log = null;
    #isReady;
    static async create(name, module, options) {
        const instance = new IDBMirrorVFS(name, module, options);
        await instance.isReady();
        return instance;
    }
    constructor(name, module, options = {}) {
        super(name, module);
        this.#isReady = this.#initialize(name);
    }
    async #initialize(name) {
        this.#idb = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = (event) => {
                const db = request.result;
                switch (event.oldVersion) {
                    case 0:
                        db.createObjectStore('blocks', { keyPath: ['path', 'offset'] });
                        db.createObjectStore('tx', { keyPath: ['path', 'txId'] });
                        break;
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    close() {
        this.#idb.close();
    }
    async isReady() {
        await super.isReady();
        await this.#isReady;
        return true;
    }
    async jOpen(zName, fileId, flags, pOutFlags) {
        try {
            const url = new URL(zName || Math.random().toString(36).slice(2), 'file://');
            const path = url.pathname;
            let file;
            if (flags & VFS.SQLITE_OPEN_MAIN_DB) {
                file = new File(path, flags);
                const idbTx = this.#idb.transaction(['blocks', 'tx'], 'readwrite');
                const blocks = idbTx.objectStore('blocks');
                if (await idbX(blocks.count([path, 0])) === 0) {
                    if (flags & VFS.SQLITE_OPEN_CREATE) {
                        await idbX(blocks.put({ path, offset: 0, data: new Uint8Array(0) }));
                    }
                    else {
                        throw new Error('File not found');
                    }
                }
                await new Promise((resolve, reject) => {
                    const range = IDBKeyRange.bound([path, 0], [path, Infinity]);
                    const request = blocks.openCursor(range);
                    request.onsuccess = () => {
                        const cursor = request.result;
                        if (cursor) {
                            const { offset, data } = cursor.value;
                            file.blocks.set(offset, data);
                            cursor.continue();
                        }
                        else {
                            resolve();
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
                file.blockSize = file.blocks.get(0)?.byteLength ?? 0;
                const transactions = idbTx.objectStore('tx');
                file.viewTx = await new Promise((resolve, reject) => {
                    const range = IDBKeyRange.bound([path, 0], [path, Infinity]);
                    const request = transactions.openCursor(range, 'prev');
                    request.onsuccess = () => {
                        const cursor = request.result;
                        if (cursor) {
                            resolve(cursor.value);
                        }
                        else {
                            resolve({ txId: 0 });
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
                await this.#setView(file, file.viewTx);
                file.broadcastChannel.addEventListener('message', event => {
                    file.broadcastReceived.push(event.data);
                    if (file.lockState === VFS.SQLITE_LOCK_NONE) {
                        this.#processBroadcasts(file);
                    }
                });
            }
            else {
                file = this.#mapPathToFile.get(path);
                if (!file) {
                    if (flags & VFS.SQLITE_OPEN_CREATE) {
                        file = new File(path, flags);
                        file.blocks.set(0, new Uint8Array(0));
                    }
                    else {
                        throw new Error('File not found');
                    }
                }
            }
            pOutFlags.setInt32(0, flags, true);
            this.#mapIdToFile.set(fileId, file);
            this.#mapPathToFile.set(path, file);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_CANTOPEN;
        }
    }
    async jDelete(zName, syncDir) {
        try {
            const url = new URL(zName, 'file://');
            const pathname = url.pathname;
            const result = await this.#deleteFile(pathname);
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
            const exists = this.#mapPathToFile.has(pathname);
            pResOut.setInt32(0, exists ? 1 : 0, true);
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.#lastError = e;
            return VFS.SQLITE_IOERR_ACCESS;
        }
    }
    async jClose(fileId) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            this.#mapIdToFile.delete(fileId);
            if (file?.flags & VFS.SQLITE_OPEN_MAIN_DB) {
                file.broadcastChannel.close();
                file.viewReleaser?.();
            }
            if (file?.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
                this.#deleteFile(file.path);
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
            let pDataOffset = 0;
            while (pDataOffset < pData.byteLength) {
                const fileOffset = iOffset + pDataOffset;
                const blockIndex = Math.floor(fileOffset / file.blockSize);
                const blockOffset = fileOffset % file.blockSize;
                const block = file.txActive?.blocks.get(blockIndex * file.blockSize) ??
                    file.blocks.get(blockIndex * file.blockSize);
                if (!block) {
                    break;
                }
                const blockLength = Math.min(block.byteLength - blockOffset, pData.byteLength - pDataOffset);
                pData.set(block.subarray(blockOffset, blockOffset + blockLength), pDataOffset);
                pDataOffset += blockLength;
                bytesRead += blockLength;
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
                this.#requireTxActive(file);
                for (let fillOffset = file.txActive.fileSize; fillOffset < iOffset; fillOffset += pData.byteLength) {
                    file.txActive.blocks.set(fillOffset, new Uint8Array(pData.byteLength));
                }
                file.txActive.blocks.set(iOffset, pData.slice());
                file.txActive.fileSize = Math.max(file.txActive.fileSize, iOffset + pData.byteLength);
                file.blockSize = pData.byteLength;
            }
            else {
                let block = file.blocks.get(0);
                if (iOffset + pData.byteLength > block.byteLength) {
                    const newSize = Math.max(iOffset + pData.byteLength, 2 * block.byteLength);
                    const newBlock = new Uint8Array(newSize);
                    newBlock.set(block);
                    file.blocks.set(0, newBlock);
                    block = newBlock;
                }
                block.set(pData, iOffset);
                file.blockSize = Math.max(file.blockSize, iOffset + pData.byteLength);
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            this.lastError = e;
            return VFS.SQLITE_IOERR_WRITE;
        }
    }
    jTruncate(fileId, iSize) {
        try {
            const file = this.#mapIdToFile.get(fileId);
            if (file.flags & VFS.SQLITE_OPEN_MAIN_DB) {
                this.#requireTxActive(file);
                file.txActive.fileSize = iSize;
            }
            else {
                if (iSize < file.blockSize) {
                    const block = file.blocks.get(0);
                    file.blocks.set(0, block.subarray(0, iSize));
                    file.blockSize = iSize;
                }
            }
            return VFS.SQLITE_OK;
        }
        catch (e) {
            console.error(e);
            this.lastError = e;
            return VFS.SQLITE_IOERR_TRUNCATE;
        }
    }
    jFileSize(fileId, pSize64) {
        const file = this.#mapIdToFile.get(fileId);
        const size = file.txActive?.fileSize ?? file.blockSize * file.blocks.size;
        pSize64.setBigInt64(0, BigInt(size), true);
        return VFS.SQLITE_OK;
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
                break;
            case VFS.SQLITE_LOCK_RESERVED:
                if (!file.locks.hint && !await this.#lock(file, 'hint', POLL_EXCLUSIVE)) {
                    return VFS.SQLITE_BUSY;
                }
                if (!await this.#lock(file, 'reserved', POLL_EXCLUSIVE)) {
                    file.locks.hint();
                    return VFS.SQLITE_BUSY;
                }
                const idbTx = this.#idb.transaction(['blocks', 'tx']);
                const range = IDBKeyRange.bound([file.path, file.viewTx.txId], [file.path, Infinity]);
                const entries = await idbX(idbTx.objectStore('tx').getAll(range));
                if (entries.length && entries.at(-1).txId > file.viewTx.txId) {
                    const blocks = idbTx.objectStore('blocks');
                    for (const entry of entries) {
                        for (const offset of Array.from(entry.blocks.keys())) {
                            const value = await idbX(blocks.get([file.path, offset]));
                            entry.blocks.set(offset, value.data);
                        }
                    }
                    file.broadcastReceived.push(...entries);
                    file.locks.reserved();
                    return VFS.SQLITE_BUSY;
                }
                console.assert(entries[0]?.txId === file.viewTx.txId || !file.viewTx.txId);
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
            console.assert(!!(file.flags & VFS.SQLITE_OPEN_MAIN_DB));
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
                            if (value && file.blockSize && Number(value) !== file.blockSize) {
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
                                    case 'normal':
                                    case '1':
                                        file.synchronous = 'normal';
                                        break;
                                    default:
                                        console.warn(`unsupported synchronous mode: ${value}`);
                                        return VFS.SQLITE_ERROR;
                                }
                            }
                            break;
                    }
                    break;
                case VFS.SQLITE_FCNTL_BEGIN_ATOMIC_WRITE:
                    this.log?.('xFileControl', 'BEGIN_ATOMIC_WRITE', file.path);
                    return VFS.SQLITE_OK;
                case VFS.SQLITE_FCNTL_COMMIT_ATOMIC_WRITE:
                    this.log?.('xFileControl', 'COMMIT_ATOMIC_WRITE', file.path);
                    return VFS.SQLITE_OK;
                case VFS.SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE:
                    this.#dropTx(file);
                    return VFS.SQLITE_OK;
                case VFS.SQLITE_FCNTL_SYNC:
                    this.log?.('xFileControl', 'SYNC', file.path);
                    if (file.txActive && !file.txOverwrite) {
                        await this.#commitTx(file);
                    }
                    break;
                case VFS.SQLITE_FCNTL_OVERWRITE:
                    file.txOverwrite = true;
                    break;
                case VFS.SQLITE_FCNTL_COMMIT_PHASETWO:
                    this.log?.('xFileControl', 'COMMIT_PHASETWO', file.path);
                    if (file.txActive) {
                        await this.#commitTx(file);
                    }
                    file.txOverwrite = false;
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
    #acceptTx(file, tx) {
        for (const [offset, data] of tx.blocks) {
            file.blocks.set(offset, data);
            if (file.blockSize === 0) {
                file.blockSize = data.byteLength;
            }
        }
        let truncated = tx.fileSize + file.blockSize;
        while (file.blocks.delete(truncated)) {
            truncated += file.blockSize;
        }
        file.viewTx = tx;
    }
    async #commitTx(file) {
        this.#acceptTx(file, file.txActive);
        this.#setView(file, file.txActive);
        const oldestTxId = await this.#getOldestTxInUse(file);
        const idbTx = this.#idb.transaction(['blocks', 'tx'], 'readwrite');
        const blocks = idbTx.objectStore('blocks');
        for (const [offset, data] of file.txActive.blocks) {
            blocks.put({ path: file.path, offset, data });
        }
        const oldRange = IDBKeyRange.bound([file.path, -Infinity], [file.path, oldestTxId], false, true);
        idbTx.objectStore('tx').delete(oldRange);
        const txSansData = Object.assign({}, file.txActive);
        txSansData.blocks = new Map(Array.from(file.txActive.blocks, ([k]) => [k, null]));
        idbTx.objectStore('tx').put(txSansData);
        const complete = new Promise((resolve, reject) => {
            const message = file.txActive;
            idbTx.oncomplete = () => {
                file.broadcastChannel.postMessage(message);
                resolve();
            };
            idbTx.onabort = () => reject(idbTx.error);
            idbTx.commit();
        });
        if (file.synchronous === 'full') {
            await complete;
        }
        file.txActive = null;
        file.txWriteHint = false;
    }
    #dropTx(file) {
        file.txActive = null;
        file.txWriteHint = false;
    }
    #requireTxActive(file) {
        if (!file.txActive) {
            file.txActive = {
                path: file.path,
                txId: file.viewTx.txId + 1,
                blocks: new Map(),
                fileSize: file.blockSize * file.blocks.size,
            };
        }
    }
    async #deleteFile(path) {
        this.#mapPathToFile.delete(path);
        const request = this.#idb.transaction(['blocks'], 'readwrite')
            .objectStore('blocks')
            .delete(IDBKeyRange.bound([path, 0], [path, Infinity]));
        await new Promise((resolve, reject) => {
            const idbTx = request.transaction;
            idbTx.oncomplete = resolve;
            idbTx.onerror = () => reject(idbTx.error);
        });
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
    #processBroadcasts(file) {
        file.broadcastReceived.sort((a, b) => a.txId - b.txId);
        let nHandled = 0;
        let newTx = file.viewTx;
        for (const message of file.broadcastReceived) {
            if (message.txId <= newTx.txId) {
                // already incorporated
            }
            else if (message.txId === newTx.txId + 1) {
                this.log?.(`accept tx ${message.txId}`);
                this.#acceptTx(file, message);
                newTx = message;
            }
            else {
                console.warn(`missing tx ${newTx.txId + 1} (got ${message.txId})`);
                break;
            }
            nHandled++;
        }
        file.broadcastReceived.splice(0, nHandled);
        if (newTx.txId > file.viewTx.txId) {
            this.#setView(file, newTx);
        }
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
