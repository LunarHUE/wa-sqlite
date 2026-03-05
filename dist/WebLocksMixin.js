import * as VFS from './VFS';
const SHARED = { mode: 'shared' };
const POLL_SHARED = { ifAvailable: true, mode: 'shared' };
const POLL_EXCLUSIVE = { ifAvailable: true, mode: 'exclusive' };
const POLICIES = ['exclusive', 'shared', 'shared+hint'];
export const WebLocksMixin = (superclass) => class extends superclass {
    #options = {
        lockPolicy: 'exclusive',
        lockTimeout: Infinity
    };
    #mapIdToState = new Map();
    constructor(name, module, options) {
        super(name, module, options);
        Object.assign(this.#options, options);
        if (POLICIES.indexOf(this.#options.lockPolicy) === -1) {
            throw new Error(`WebLocksMixin: invalid lock mode: ${options.lockPolicy}`);
        }
    }
    async jLock(fileId, lockType) {
        try {
            const lockState = this.#getLockState(fileId);
            if (lockType <= lockState.type)
                return VFS.SQLITE_OK;
            switch (this.#options.lockPolicy) {
                case 'exclusive':
                    return await this.#lockExclusive(lockState, lockType);
                case 'shared':
                case 'shared+hint':
                    return await this.#lockShared(lockState, lockType);
            }
        }
        catch (e) {
            console.error('WebLocksMixin: lock error', e);
            return VFS.SQLITE_IOERR_LOCK;
        }
    }
    async jUnlock(fileId, lockType) {
        try {
            const lockState = this.#getLockState(fileId);
            if (!(lockType < lockState.type))
                return VFS.SQLITE_OK;
            switch (this.#options.lockPolicy) {
                case 'exclusive':
                    return await this.#unlockExclusive(lockState, lockType);
                case 'shared':
                case 'shared+hint':
                    return await this.#unlockShared(lockState, lockType);
            }
        }
        catch (e) {
            console.error('WebLocksMixin: unlock error', e);
            return VFS.SQLITE_IOERR_UNLOCK;
        }
    }
    async jCheckReservedLock(fileId, pResOut) {
        try {
            const lockState = this.#getLockState(fileId);
            switch (this.#options.lockPolicy) {
                case 'exclusive':
                    return this.#checkReservedExclusive(lockState, pResOut);
                case 'shared':
                case 'shared+hint':
                    return await this.#checkReservedShared(lockState, pResOut);
            }
        }
        catch (e) {
            console.error('WebLocksMixin: check reserved lock error', e);
            return VFS.SQLITE_IOERR_CHECKRESERVEDLOCK;
        }
        pResOut.setInt32(0, 0, true);
        return VFS.SQLITE_OK;
    }
    jFileControl(fileId, op, pArg) {
        if (op === WebLocksMixin.WRITE_HINT_OP_CODE &&
            this.#options.lockPolicy === 'shared+hint') {
            const lockState = this.#getLockState(fileId);
            lockState.writeHint = true;
        }
        return VFS.SQLITE_NOTFOUND;
    }
    #getLockState(fileId) {
        let lockState = this.#mapIdToState.get(fileId);
        if (!lockState) {
            const name = this.getFilename(fileId);
            lockState = {
                baseName: name,
                type: VFS.SQLITE_LOCK_NONE,
                writeHint: false
            };
            this.#mapIdToState.set(fileId, lockState);
        }
        return lockState;
    }
    async #lockExclusive(lockState, lockType) {
        if (!lockState.access) {
            if (!await this.#acquire(lockState, 'access')) {
                return VFS.SQLITE_BUSY;
            }
            console.assert(!!lockState.access);
        }
        lockState.type = lockType;
        return VFS.SQLITE_OK;
    }
    #unlockExclusive(lockState, lockType) {
        if (lockType === VFS.SQLITE_LOCK_NONE) {
            lockState.access?.();
            console.assert(!lockState.access);
        }
        lockState.type = lockType;
        return VFS.SQLITE_OK;
    }
    #checkReservedExclusive(lockState, pResOut) {
        pResOut.setInt32(0, 0, true);
        return VFS.SQLITE_OK;
    }
    async #lockShared(lockState, lockType) {
        switch (lockState.type) {
            case VFS.SQLITE_LOCK_NONE:
                switch (lockType) {
                    case VFS.SQLITE_LOCK_SHARED:
                        if (lockState.writeHint) {
                            if (!await this.#acquire(lockState, 'hint')) {
                                return VFS.SQLITE_BUSY;
                            }
                        }
                        if (!await this.#acquire(lockState, 'gate', SHARED)) {
                            lockState.hint?.();
                            return VFS.SQLITE_BUSY;
                        }
                        if (!await this.#acquire(lockState, 'access', SHARED)) {
                            lockState.gate();
                            lockState.hint?.();
                            return VFS.SQLITE_BUSY;
                        }
                        lockState.gate();
                        console.assert(!lockState.gate);
                        console.assert(!!lockState.access);
                        console.assert(!lockState.reserved);
                        break;
                    default:
                        throw new Error('unsupported lock transition');
                }
                break;
            case VFS.SQLITE_LOCK_SHARED:
                switch (lockType) {
                    case VFS.SQLITE_LOCK_RESERVED:
                        if (this.#options.lockPolicy === 'shared+hint') {
                            if (!lockState.hint &&
                                !await this.#acquire(lockState, 'hint', POLL_EXCLUSIVE)) {
                                return VFS.SQLITE_BUSY;
                            }
                        }
                        if (!await this.#acquire(lockState, 'reserved', POLL_EXCLUSIVE)) {
                            lockState.hint?.();
                            return VFS.SQLITE_BUSY;
                        }
                        lockState.access();
                        console.assert(!lockState.gate);
                        console.assert(!lockState.access);
                        console.assert(!!lockState.reserved);
                        break;
                    case VFS.SQLITE_LOCK_EXCLUSIVE:
                        if (!await this.#acquire(lockState, 'gate')) {
                            return VFS.SQLITE_BUSY;
                        }
                        lockState.access();
                        if (!await this.#acquire(lockState, 'access')) {
                            lockState.gate();
                            return VFS.SQLITE_BUSY;
                        }
                        console.assert(!!lockState.gate);
                        console.assert(!!lockState.access);
                        console.assert(!lockState.reserved);
                        break;
                    default:
                        throw new Error('unsupported lock transition');
                }
                break;
            case VFS.SQLITE_LOCK_RESERVED:
                switch (lockType) {
                    case VFS.SQLITE_LOCK_EXCLUSIVE:
                        if (!await this.#acquire(lockState, 'gate')) {
                            return VFS.SQLITE_BUSY;
                        }
                        if (!await this.#acquire(lockState, 'access')) {
                            lockState.gate();
                            return VFS.SQLITE_BUSY;
                        }
                        console.assert(!!lockState.gate);
                        console.assert(!!lockState.access);
                        console.assert(!!lockState.reserved);
                        break;
                    default:
                        throw new Error('unsupported lock transition');
                }
                break;
        }
        lockState.type = lockType;
        return VFS.SQLITE_OK;
    }
    async #unlockShared(lockState, lockType) {
        if (lockType === VFS.SQLITE_LOCK_NONE) {
            lockState.access?.();
            lockState.gate?.();
            lockState.reserved?.();
            lockState.hint?.();
            lockState.writeHint = false;
            console.assert(!lockState.access);
            console.assert(!lockState.gate);
            console.assert(!lockState.reserved);
            console.assert(!lockState.hint);
        }
        else {
            switch (lockState.type) {
                case VFS.SQLITE_LOCK_EXCLUSIVE:
                    lockState.access();
                    if (!await this.#acquire(lockState, 'access', SHARED)) {
                        lockState.gate();
                        lockState.reserved?.();
                        lockState.hint?.();
                        lockState.type = VFS.SQLITE_LOCK_NONE;
                        return VFS.SQLITE_IOERR_UNLOCK;
                    }
                    lockState.gate();
                    lockState.reserved?.();
                    lockState.hint?.();
                    console.assert(!!lockState.access);
                    console.assert(!lockState.gate);
                    console.assert(!lockState.reserved);
                    break;
                case VFS.SQLITE_LOCK_RESERVED:
                    if (!await this.#acquire(lockState, 'access', SHARED)) {
                        lockState.reserved();
                        lockState.hint?.();
                        lockState.type = VFS.SQLITE_LOCK_NONE;
                        return VFS.SQLITE_IOERR_UNLOCK;
                    }
                    lockState.reserved();
                    lockState.hint?.();
                    console.assert(!!lockState.access);
                    console.assert(!lockState.gate);
                    console.assert(!lockState.reserved);
                    break;
            }
        }
        lockState.type = lockType;
        return VFS.SQLITE_OK;
    }
    async #checkReservedShared(lockState, pResOut) {
        if (await this.#acquire(lockState, 'reserved', POLL_SHARED)) {
            lockState.reserved();
            pResOut.setInt32(0, 0, true);
        }
        else {
            pResOut.setInt32(0, 1, true);
        }
        return VFS.SQLITE_OK;
    }
    #acquire(lockState, name, options = {}) {
        console.assert(!lockState[name]);
        return new Promise(resolve => {
            if (!options.ifAvailable && this.#options.lockTimeout < Infinity) {
                const controller = new AbortController();
                options = Object.assign({}, options, { signal: controller.signal });
                setTimeout(() => {
                    controller.abort();
                    resolve?.(false);
                }, this.#options.lockTimeout);
            }
            const lockName = `lock##${lockState.baseName}##${name}`;
            navigator.locks.request(lockName, options, lock => {
                if (lock) {
                    return new Promise(release => {
                        lockState[name] = () => {
                            release();
                            lockState[name] = null;
                        };
                        resolve(true);
                        resolve = null;
                    });
                }
                else {
                    lockState[name] = null;
                    resolve(false);
                    resolve = null;
                }
            }).catch(e => {
                if (e.name !== 'AbortError')
                    throw e;
            });
        });
    }
};
WebLocksMixin.WRITE_HINT_OP_CODE = -9999;
