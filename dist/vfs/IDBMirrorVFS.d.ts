import { FacadeVFS } from '../FacadeVFS';
export declare class IDBMirrorVFS extends FacadeVFS {
    #private;
    log: any;
    static create(name: string, module: any, options?: any): Promise<IDBMirrorVFS>;
    constructor(name: string, module: any, options?: any);
    close(): void;
    isReady(): Promise<boolean>;
    jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): Promise<number>;
    jDelete(zName: string, syncDir: number): Promise<number>;
    jAccess(zName: string, flags: number, pResOut: DataView): Promise<number>;
    jClose(fileId: number): Promise<number>;
    jRead(fileId: number, pData: Uint8Array, iOffset: number): number;
    jWrite(fileId: number, pData: Uint8Array, iOffset: number): number;
    jTruncate(fileId: number, iSize: number): number;
    jFileSize(fileId: number, pSize64: DataView): number | Promise<number>;
    jLock(fileId: number, lockType: number): Promise<number>;
    jUnlock(fileId: number, lockType: number): number;
    jCheckReservedLock(fileId: number, pResOut: DataView): Promise<number>;
    jFileControl(fileId: number, op: number, pArg: DataView): Promise<number>;
    jDeviceCharacteristics(fileId: number): number | Promise<number>;
    jGetLastError(zBuf: Uint8Array): number;
}
