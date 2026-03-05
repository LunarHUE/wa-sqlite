import { FacadeVFS } from '../FacadeVFS';
interface MemoryFile {
    pathname: string;
    flags: number;
    size: number;
    data: ArrayBuffer;
}
export declare class MemoryVFS extends FacadeVFS {
    mapNameToFile: Map<string, MemoryFile>;
    mapIdToFile: Map<number, MemoryFile>;
    static create(name: string, module: any): Promise<MemoryVFS>;
    constructor(name: string, module: any);
    close(): void;
    jOpen(filename: string | null, fileId: number, flags: number, pOutFlags: DataView): number | Promise<number>;
    jClose(fileId: number): number | Promise<number>;
    jRead(fileId: number, pData: Uint8Array, iOffset: number): number | Promise<number>;
    jWrite(fileId: number, pData: Uint8Array, iOffset: number): number | Promise<number>;
    jTruncate(fileId: number, iSize: number): number | Promise<number>;
    jFileSize(fileId: number, pSize64: DataView): number | Promise<number>;
    jDelete(name: string, syncDir: number): number | Promise<number>;
    jAccess(name: string, flags: number, pResOut: DataView): number | Promise<number>;
}
export {};
