declare class File {
    pathname: string;
    flags: number;
    fileHandle: FileSystemFileHandle;
    accessHandle: FileSystemSyncAccessHandle;
    handleRequestChannel: BroadcastChannel;
    handleLockReleaser: (() => void) | null;
    isHandleRequested: boolean;
    isFileLocked: boolean;
    openLockReleaser: (() => void) | null;
    constructor(pathname: string, flags: number);
}
declare const OPFSAdaptiveVFS_base: {
    new (name: string, module: any, options?: import("../WebLocksMixin").WebLocksMixinOptions): {
        [x: string]: any;
        "__#private@#options": {
            lockPolicy: string;
            lockTimeout: number;
        };
        "__#private@#mapIdToState": Map<number, import("../WebLocksMixin").LockState>;
        jLock(fileId: number, lockType: number): Promise<number>;
        jUnlock(fileId: number, lockType: number): Promise<number>;
        jCheckReservedLock(fileId: number, pResOut: DataView): Promise<number>;
        jFileControl(fileId: number, op: number, pArg: DataView): number | Promise<number>;
        "__#private@#getLockState"(fileId: number): import("../WebLocksMixin").LockState;
        "__#private@#lockExclusive"(lockState: import("../WebLocksMixin").LockState, lockType: number): Promise<number>;
        "__#private@#unlockExclusive"(lockState: import("../WebLocksMixin").LockState, lockType: number): number;
        "__#private@#checkReservedExclusive"(lockState: import("../WebLocksMixin").LockState, pResOut: DataView): number;
        "__#private@#lockShared"(lockState: import("../WebLocksMixin").LockState, lockType: number): Promise<number>;
        "__#private@#unlockShared"(lockState: import("../WebLocksMixin").LockState, lockType: number): Promise<number>;
        "__#private@#checkReservedShared"(lockState: import("../WebLocksMixin").LockState, pResOut: DataView): Promise<number>;
        "__#private@#acquire"(lockState: import("../WebLocksMixin").LockState, name: "gate" | "access" | "reserved" | "hint", options?: LockOptions): Promise<boolean>;
    };
    [x: string]: any;
};
export declare class OPFSAdaptiveVFS extends OPFSAdaptiveVFS_base {
    mapIdToFile: Map<number, File>;
    lastError: any;
    log: any;
    static create(name: string, module: any, options?: any): Promise<OPFSAdaptiveVFS>;
    constructor(name: string, module: any, options?: any);
    getFilename(fileId: number): string;
    jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): Promise<number>;
    jDelete(zName: string, syncDir: number): Promise<number>;
    jAccess(zName: string, flags: number, pResOut: DataView): Promise<number>;
    jClose(fileId: number): Promise<number>;
    jRead(fileId: number, pData: Uint8Array, iOffset: number): number;
    jWrite(fileId: number, pData: Uint8Array, iOffset: number): number;
    jTruncate(fileId: number, iSize: number): number;
    jSync(fileId: number, flags: number): number;
    jFileSize(fileId: number, pSize64: DataView): number;
    jLock(fileId: number, lockType: number): Promise<number>;
    jUnlock(fileId: number, lockType: number): Promise<number>;
    jFileControl(fileId: number, op: number, pArg: DataView): number | Promise<number>;
    jGetLastError(zBuf: Uint8Array): number;
}
export {};
