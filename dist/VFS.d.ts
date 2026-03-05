export * from './sqlite-constants';
export declare class Base {
    name: string;
    mxPathname: number;
    _module: any;
    constructor(name: string, module: any);
    close(): void | Promise<void>;
    isReady(): boolean | Promise<boolean>;
    hasAsyncMethod(methodName: string): boolean;
    xOpen(pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number): number | Promise<number>;
    xDelete(pVfs: number, zName: number, syncDir: number): number | Promise<number>;
    xAccess(pVfs: number, zName: number, flags: number, pResOut: number): number | Promise<number>;
    xFullPathname(pVfs: number, zName: number, nOut: number, zOut: number): number | Promise<number>;
    xGetLastError(pVfs: number, nBuf: number, zBuf: number): number | Promise<number>;
    xClose(pFile: number): number | Promise<number>;
    xRead(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number | Promise<number>;
    xWrite(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number | Promise<number>;
    xTruncate(pFile: number, sizeLo: number, sizeHi: number): number | Promise<number>;
    xSync(pFile: number, flags: number): number | Promise<number>;
    xFileSize(pFile: number, pSize: number): number | Promise<number>;
    xLock(pFile: number, lockType: number): number | Promise<number>;
    xUnlock(pFile: number, lockType: number): number | Promise<number>;
    xCheckReservedLock(pFile: number, pResOut: number): number | Promise<number>;
    xFileControl(pFile: number, op: number, pArg: number): number | Promise<number>;
    xSectorSize(pFile: number): number | Promise<number>;
    xDeviceCharacteristics(pFile: number): number | Promise<number>;
}
export declare const FILE_TYPE_MASK: number;
