import { MemoryVFS } from './MemoryVFS';
export declare class MemoryAsyncVFS extends MemoryVFS {
    static create(name: string, module: any): Promise<MemoryAsyncVFS>;
    constructor(name: string, module: any);
    close(): Promise<void>;
    jOpen(name: string | null, fileId: number, flags: number, pOutFlags: DataView): Promise<number>;
    jClose(fileId: number): Promise<number>;
    jRead(fileId: number, pData: Uint8Array, iOffset: number): Promise<number>;
    jWrite(fileId: number, pData: Uint8Array, iOffset: number): Promise<number>;
    xTruncate(fileId: number, iSize: number): Promise<number>;
    jFileSize(fileId: number, pSize64: DataView): Promise<number>;
    jDelete(name: string, syncDir: number): Promise<number>;
    jAccess(name: string, flags: number, pResOut: DataView): Promise<number>;
}
