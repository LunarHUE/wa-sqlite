interface LockState {
    baseName: string;
    type: number;
    writeHint: boolean;
    gate?: (() => void) | null;
    access?: (() => void) | null;
    reserved?: (() => void) | null;
    hint?: (() => void) | null;
}
interface WebLocksMixinOptions {
    lockPolicy?: string;
    lockTimeout?: number;
}
export declare const WebLocksMixin: {
    (superclass: any): {
        new (name: string, module: any, options?: WebLocksMixinOptions): {
            [x: string]: any;
            "__#private@#options": {
                lockPolicy: string;
                lockTimeout: number;
            };
            "__#private@#mapIdToState": Map<number, LockState>;
            jLock(fileId: number, lockType: number): Promise<number>;
            jUnlock(fileId: number, lockType: number): Promise<number>;
            jCheckReservedLock(fileId: number, pResOut: DataView): Promise<number>;
            jFileControl(fileId: number, op: number, pArg: DataView): number | Promise<number>;
            "__#private@#getLockState"(fileId: number): LockState;
            "__#private@#lockExclusive"(lockState: LockState, lockType: number): Promise<number>;
            "__#private@#unlockExclusive"(lockState: LockState, lockType: number): number;
            "__#private@#checkReservedExclusive"(lockState: LockState, pResOut: DataView): number;
            "__#private@#lockShared"(lockState: LockState, lockType: number): Promise<number>;
            "__#private@#unlockShared"(lockState: LockState, lockType: number): Promise<number>;
            "__#private@#checkReservedShared"(lockState: LockState, pResOut: DataView): Promise<number>;
            "__#private@#acquire"(lockState: LockState, name: "gate" | "access" | "reserved" | "hint", options?: LockOptions): Promise<boolean>;
        };
        [x: string]: any;
    };
    WRITE_HINT_OP_CODE: number;
};
export {};
