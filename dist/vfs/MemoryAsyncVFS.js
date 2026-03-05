// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { MemoryVFS } from './MemoryVFS';
// Sample asynchronous in-memory filesystem. This filesystem requires an
// asynchronous WebAssembly build (Asyncify or JSPI).
export class MemoryAsyncVFS extends MemoryVFS {
    static async create(name, module) {
        const vfs = new MemoryVFS(name, module);
        await vfs.isReady();
        return vfs;
    }
    constructor(name, module) {
        super(name, module);
    }
    async close() {
        for (const fileId of this.mapIdToFile.keys()) {
            await this.xClose(fileId);
        }
    }
    async jOpen(name, fileId, flags, pOutFlags) {
        return super.jOpen(name, fileId, flags, pOutFlags);
    }
    async jClose(fileId) {
        return super.jClose(fileId);
    }
    async jRead(fileId, pData, iOffset) {
        return super.jRead(fileId, pData, iOffset);
    }
    async jWrite(fileId, pData, iOffset) {
        return super.jWrite(fileId, pData, iOffset);
    }
    async xTruncate(fileId, iSize) {
        return super.jTruncate(fileId, iSize);
    }
    async jFileSize(fileId, pSize64) {
        return super.jFileSize(fileId, pSize64);
    }
    async jDelete(name, syncDir) {
        return super.jDelete(name, syncDir);
    }
    async jAccess(name, flags, pResOut) {
        return super.jAccess(name, flags, pResOut);
    }
}
