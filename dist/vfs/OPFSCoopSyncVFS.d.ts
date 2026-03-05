import { FacadeVFS } from '../FacadeVFS';
declare class File {
    path: string;
    flags: number;
    accessHandle: FileSystemSyncAccessHandle;
    persistentFile: PersistentFile | null;
    constructor(path: string, flags: number);
}
declare class PersistentFile {
    fileHandle: FileSystemFileHandle;
    accessHandle: FileSystemSyncAccessHandle | null;
    isLockBusy: boolean;
    isFileLocked: boolean;
    isRequestInProgress: boolean;
    handleLockReleaser: (() => void) | null;
    handleRequestChannel: BroadcastChannel;
    isHandleRequested: boolean;
    constructor(fileHandle: FileSystemFileHandle);
}
export declare class OPFSCoopSyncVFS extends FacadeVFS {
    #private;
    mapIdToFile: Map<number, File>;
    lastError: any;
    log: any;
    persistentFiles: Map<string, PersistentFile>;
    boundAccessHandles: Map<string, FileSystemSyncAccessHandle>;
    unboundAccessHandles: Set<FileSystemSyncAccessHandle>;
    accessiblePaths: Set<string>;
    releaser: (() => void) | null;
    static create(name: string, module: any): Promise<OPFSCoopSyncVFS>;
    constructor(name: string, module: any);
    jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): number;
    jDelete(zName: string, syncDir: number): number;
    jAccess(zName: string, flags: number, pResOut: DataView): number;
    jClose(fileId: number): number;
    jRead(fileId: number, pData: Uint8Array, iOffset: number): number;
    jWrite(fileId: number, pData: Uint8Array, iOffset: number): number;
    jTruncate(fileId: number, iSize: number): number;
    jSync(fileId: number, flags: number): number;
    jFileSize(fileId: number, pSize64: DataView): number;
    jLock(fileId: number, lockType: number): number;
    jUnlock(fileId: number, lockType: number): number;
    jFileControl(fileId: number, op: number, pArg: DataView): number | Promise<number>;
    jGetLastError(zBuf: Uint8Array): number;
}
export {};
