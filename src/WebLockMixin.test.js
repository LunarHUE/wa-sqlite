/**
 * WebLocksMixin Test Harness
 * 
 * Run in a browser console or with a test runner that supports
 * navigator.locks (Chrome, Edge, Firefox, or polyfill).
 * 
 * Usage:
 *   import { runAllTests } from './WebLocksMixin.test.js';
 *   runAllTests();
 */

// ── Minimal VFS constants (matching your VFS.js) ──────────────────
const VFS = {
  SQLITE_OK: 0,
  SQLITE_BUSY: 5,
  SQLITE_IOERR_LOCK: 3850,
  SQLITE_IOERR_UNLOCK: 2058,
  SQLITE_IOERR_CHECKRESERVEDLOCK: 3594,
  SQLITE_NOTFOUND: 12,
  SQLITE_LOCK_NONE: 0,
  SQLITE_LOCK_SHARED: 1,
  SQLITE_LOCK_RESERVED: 2,
  SQLITE_LOCK_PENDING: 3,
  SQLITE_LOCK_EXCLUSIVE: 4,
};

const LOCK_NAMES = {
  [VFS.SQLITE_LOCK_NONE]: 'NONE',
  [VFS.SQLITE_LOCK_SHARED]: 'SHARED',
  [VFS.SQLITE_LOCK_RESERVED]: 'RESERVED',
  [VFS.SQLITE_LOCK_PENDING]: 'PENDING',
  [VFS.SQLITE_LOCK_EXCLUSIVE]: 'EXCLUSIVE',
};

// ── Test runner ────────────────────────────────────────────────────
const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${expected}, got ${actual}`
    );
  }
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  ✅ ${name}`);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

// ── Minimal FacadeVFS stub ─────────────────────────────────────────
class FakeVFS {
  #filenames = new Map();

  constructor(name, module, options) {
    // no-op
  }

  /** Register a fileId→filename mapping for testing. */
  _registerFile(fileId, filename) {
    this.#filenames.set(fileId, filename);
  }

  getFilename(fileId) {
    return this.#filenames.get(fileId) ?? `test-file-${fileId}`;
  }
}

// ── Inline a self-contained version of the mixin for testing ───────
// (In your real project, import { WebLocksMixin } from './WebLocksMixin.js')

// For this test file we'll build a minimal lock-state machine that
// mirrors the fixed code's logic so you can validate transitions.

const SHARED_OPT = { mode: 'shared' };
const POLL_SHARED_OPT = { ifAvailable: true, mode: 'shared' };
const POLL_EXCLUSIVE_OPT = { ifAvailable: true, mode: 'exclusive' };

const WebLocksMixin = superclass => class extends superclass {
  #options = { lockPolicy: 'exclusive', lockTimeout: Infinity };
  #mapIdToState = new Map();

  constructor(name, module, options) {
    super(name, module, options);
    Object.assign(this.#options, options);
  }

  // ── Safe release helpers ──
  #release(lockState, name, caller) {
    const fn = lockState[name];
    if (typeof fn === 'function') {
      fn();
      return true;
    }
    if (fn !== null && fn !== undefined) {
      console.error(`[${caller}] lockState.${name} is ${typeof fn}, expected function or null`);
      lockState[name] = null;
      return false;
    }
    return false;
  }

  #releaseExpected(lockState, name, caller) {
    if (!this.#release(lockState, name, caller)) {
      console.warn(`[${caller}] expected lockState.${name} to be held but it was ${lockState[name]}`);
    }
  }

  #releaseAll(lockState, caller) {
    this.#release(lockState, 'access', caller);
    this.#release(lockState, 'gate', caller);
    this.#release(lockState, 'reserved', caller);
    this.#release(lockState, 'hint', caller);
    lockState.writeHint = false;
  }

  #getLockState(fileId) {
    let s = this.#mapIdToState.get(fileId);
    if (!s) {
      s = {
        baseName: this.getFilename(fileId),
        type: VFS.SQLITE_LOCK_NONE,
        writeHint: false,
        gate: null, access: null, reserved: null, hint: null,
      };
      this.#mapIdToState.set(fileId, s);
    }
    return s;
  }

  /** Expose state for test assertions. */
  _getState(fileId) {
    return this.#getLockState(fileId);
  }

  async jLock(fileId, lockType) {
    try {
      const ls = this.#getLockState(fileId);
      if (lockType <= ls.type) return VFS.SQLITE_OK;
      switch (this.#options.lockPolicy) {
        case 'exclusive': return await this.#lockExclusive(ls, lockType);
        case 'shared':
        case 'shared+hint': return await this.#lockShared(ls, lockType);
      }
    } catch (e) {
      console.error('jLock error:', e);
      return VFS.SQLITE_IOERR_LOCK;
    }
  }

  async jUnlock(fileId, lockType) {
    try {
      const ls = this.#getLockState(fileId);
      if (!(lockType < ls.type)) return VFS.SQLITE_OK;
      switch (this.#options.lockPolicy) {
        case 'exclusive': return this.#unlockExclusive(ls, lockType);
        case 'shared':
        case 'shared+hint': return await this.#unlockShared(ls, lockType);
      }
    } catch (e) {
      console.error('jUnlock error:', e);
      return VFS.SQLITE_IOERR_UNLOCK;
    }
  }

  async #lockExclusive(ls, lockType) {
    if (!ls.access) {
      if (!await this.#acquire(ls, 'access')) return VFS.SQLITE_BUSY;
    }
    ls.type = lockType;
    return VFS.SQLITE_OK;
  }

  #unlockExclusive(ls, lockType) {
    if (lockType === VFS.SQLITE_LOCK_NONE) {
      this.#release(ls, 'access', 'unlockExclusive');
    }
    ls.type = lockType;
    return VFS.SQLITE_OK;
  }

  async #lockShared(ls, lockType) {
    const from = ls.type;
    const caller = `lockShared(${LOCK_NAMES[from]}→${LOCK_NAMES[lockType]})`;

    switch (from) {
      case VFS.SQLITE_LOCK_NONE:
        if (lockType !== VFS.SQLITE_LOCK_SHARED) return VFS.SQLITE_IOERR_LOCK;

        if (ls.writeHint) {
          if (!await this.#acquire(ls, 'hint')) return VFS.SQLITE_BUSY;
        }
        if (!await this.#acquire(ls, 'gate', SHARED_OPT)) {
          this.#release(ls, 'hint', caller);
          return VFS.SQLITE_BUSY;
        }
        if (!await this.#acquire(ls, 'access', SHARED_OPT)) {
          this.#releaseExpected(ls, 'gate', caller);
          this.#release(ls, 'hint', caller);
          return VFS.SQLITE_BUSY;
        }
        this.#releaseExpected(ls, 'gate', caller);
        break;

      case VFS.SQLITE_LOCK_SHARED:
        if (lockType === VFS.SQLITE_LOCK_RESERVED) {
          if (this.#options.lockPolicy === 'shared+hint') {
            if (!ls.hint && !await this.#acquire(ls, 'hint', POLL_EXCLUSIVE_OPT)) {
              return VFS.SQLITE_BUSY;
            }
          }
          if (!await this.#acquire(ls, 'reserved', POLL_EXCLUSIVE_OPT)) {
            this.#release(ls, 'hint', caller);
            return VFS.SQLITE_BUSY;
          }
          this.#releaseExpected(ls, 'access', caller);
        } else if (lockType === VFS.SQLITE_LOCK_EXCLUSIVE) {
          if (!await this.#acquire(ls, 'gate')) return VFS.SQLITE_BUSY;
          this.#releaseExpected(ls, 'access', caller);
          if (!await this.#acquire(ls, 'access')) {
            this.#releaseExpected(ls, 'gate', caller);
            return VFS.SQLITE_BUSY;
          }
        } else {
          return VFS.SQLITE_IOERR_LOCK;
        }
        break;

      case VFS.SQLITE_LOCK_RESERVED:
        if (lockType !== VFS.SQLITE_LOCK_EXCLUSIVE) return VFS.SQLITE_IOERR_LOCK;
        if (!await this.#acquire(ls, 'gate')) return VFS.SQLITE_BUSY;
        if (!await this.#acquire(ls, 'access')) {
          this.#releaseExpected(ls, 'gate', caller);
          return VFS.SQLITE_BUSY;
        }
        break;

      default:
        return VFS.SQLITE_IOERR_LOCK;
    }

    ls.type = lockType;
    return VFS.SQLITE_OK;
  }

  async #unlockShared(ls, lockType) {
    const from = ls.type;
    const caller = `unlockShared(${LOCK_NAMES[from]}→${LOCK_NAMES[lockType]})`;

    if (lockType === VFS.SQLITE_LOCK_NONE) {
      this.#releaseAll(ls, caller);
      ls.type = VFS.SQLITE_LOCK_NONE;
      return VFS.SQLITE_OK;
    }

    // → SHARED
    switch (from) {
      case VFS.SQLITE_LOCK_EXCLUSIVE:
        this.#releaseExpected(ls, 'access', caller);
        if (!await this.#acquire(ls, 'access', SHARED_OPT)) {
          this.#releaseAll(ls, caller);
          ls.type = VFS.SQLITE_LOCK_NONE;
          return VFS.SQLITE_IOERR_UNLOCK;
        }
        this.#releaseExpected(ls, 'gate', caller);
        this.#release(ls, 'reserved', caller);
        this.#release(ls, 'hint', caller);
        break;

      case VFS.SQLITE_LOCK_RESERVED:
        if (!await this.#acquire(ls, 'access', SHARED_OPT)) {
          this.#releaseAll(ls, caller);
          ls.type = VFS.SQLITE_LOCK_NONE;
          return VFS.SQLITE_IOERR_UNLOCK;
        }
        this.#releaseExpected(ls, 'reserved', caller);
        this.#release(ls, 'hint', caller);
        break;
    }

    ls.type = lockType;
    return VFS.SQLITE_OK;
  }

  #acquire(lockState, name, options = {}) {
    if (typeof lockState[name] === 'function') {
      console.warn(`[acquire] "${name}" already held for ${lockState.baseName}`);
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

      if (!options.ifAvailable && this.#options.lockTimeout < Infinity) {
        const ctrl = new AbortController();
        options = { ...options, signal: ctrl.signal };
        setTimeout(() => { ctrl.abort(); settle(false); }, this.#options.lockTimeout);
      }

      const lockName = `lock##${lockState.baseName}##${name}`;
      navigator.locks.request(lockName, options, lock => {
        if (lock) {
          return new Promise(release => {
            lockState[name] = () => { release(); lockState[name] = null; };
            settle(true);
          });
        } else {
          lockState[name] = null;
          settle(false);
        }
      }).catch(e => {
        if (e.name !== 'AbortError') console.error('[acquire] error:', e);
        settle(false);
      });
    });
  }
};

WebLocksMixin.WRITE_HINT_OP_CODE = -9999;


// ── Build the testable class ──────────────────────────────────────
const TestVFS = WebLocksMixin(FakeVFS);

// ══════════════════════════════════════════════════════════════════
// TEST SUITES
// ══════════════════════════════════════════════════════════════════

async function testExclusivePolicy() {
  console.log('\n── Exclusive Policy ──');
  const vfs = new TestVFS('test', null, { lockPolicy: 'exclusive' });
  vfs._registerFile(1, 'test.db');

  await test('NONE → SHARED', async () => {
    const rc = await vfs.jLock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(rc, VFS.SQLITE_OK, 'lock result');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_SHARED, 'state type');
    assert(typeof s.access === 'function', 'access lock should be held');
  });

  await test('SHARED → RESERVED', async () => {
    const rc = await vfs.jLock(1, VFS.SQLITE_LOCK_RESERVED);
    assertEqual(rc, VFS.SQLITE_OK, 'lock result');
    assertEqual(vfs._getState(1).type, VFS.SQLITE_LOCK_RESERVED, 'state type');
  });

  await test('RESERVED → EXCLUSIVE', async () => {
    const rc = await vfs.jLock(1, VFS.SQLITE_LOCK_EXCLUSIVE);
    assertEqual(rc, VFS.SQLITE_OK, 'lock result');
    assertEqual(vfs._getState(1).type, VFS.SQLITE_LOCK_EXCLUSIVE, 'state type');
  });

  await test('EXCLUSIVE → NONE', async () => {
    const rc = await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE);
    assertEqual(rc, VFS.SQLITE_OK, 'unlock result');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_NONE, 'state type');
    assertEqual(s.access, null, 'access should be released');
  });

  await test('idempotent lock (already at level)', async () => {
    await vfs.jLock(1, VFS.SQLITE_LOCK_SHARED);
    const rc = await vfs.jLock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(rc, VFS.SQLITE_OK, 'should be no-op');
    await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE);
  });

  await test('idempotent unlock (already at level)', async () => {
    const rc = await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE);
    assertEqual(rc, VFS.SQLITE_OK, 'should be no-op');
  });
}

async function testSharedPolicy() {
  console.log('\n── Shared Policy ──');
  const vfs = new TestVFS('test', null, { lockPolicy: 'shared' });
  vfs._registerFile(1, 'shared-test.db');

  await test('NONE → SHARED', async () => {
    const rc = await vfs.jLock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(rc, VFS.SQLITE_OK, 'lock result');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_SHARED, 'state type');
    assert(typeof s.access === 'function', 'access should be held');
    assertEqual(s.gate, null, 'gate should be released after acquiring access');
  });

  await test('SHARED → RESERVED', async () => {
    const rc = await vfs.jLock(1, VFS.SQLITE_LOCK_RESERVED);
    assertEqual(rc, VFS.SQLITE_OK, 'lock result');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_RESERVED, 'state type');
    assert(typeof s.reserved === 'function', 'reserved should be held');
    assertEqual(s.access, null, 'access should be released after RESERVED');
  });

  await test('RESERVED → EXCLUSIVE', async () => {
    const rc = await vfs.jLock(1, VFS.SQLITE_LOCK_EXCLUSIVE);
    assertEqual(rc, VFS.SQLITE_OK, 'lock result');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_EXCLUSIVE, 'state type');
    assert(typeof s.access === 'function', 'access should be held');
    assert(typeof s.gate === 'function', 'gate should be held');
    assert(typeof s.reserved === 'function', 'reserved should be held');
  });

  await test('EXCLUSIVE → SHARED', async () => {
    const rc = await vfs.jUnlock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(rc, VFS.SQLITE_OK, 'unlock result');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_SHARED, 'state type');
    assert(typeof s.access === 'function', 'access should be re-held as shared');
    assertEqual(s.gate, null, 'gate should be released');
    assertEqual(s.reserved, null, 'reserved should be released');
  });

  await test('SHARED → NONE', async () => {
    const rc = await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE);
    assertEqual(rc, VFS.SQLITE_OK, 'unlock result');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_NONE, 'state type');
    assertEqual(s.access, null, 'all locks released');
    assertEqual(s.gate, null, 'all locks released');
    assertEqual(s.reserved, null, 'all locks released');
  });
}

async function testSharedPolicyConcurrency() {
  console.log('\n── Shared Policy: Concurrency ──');

  await test('two connections can hold SHARED simultaneously', async () => {
    const vfs1 = new TestVFS('test', null, { lockPolicy: 'shared' });
    const vfs2 = new TestVFS('test', null, { lockPolicy: 'shared' });
    // Use same file name so they compete for the same Web Locks
    vfs1._registerFile(1, 'concurrent.db');
    vfs2._registerFile(1, 'concurrent.db');

    const rc1 = await vfs1.jLock(1, VFS.SQLITE_LOCK_SHARED);
    const rc2 = await vfs2.jLock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(rc1, VFS.SQLITE_OK, 'conn1 shared');
    assertEqual(rc2, VFS.SQLITE_OK, 'conn2 shared');

    await vfs1.jUnlock(1, VFS.SQLITE_LOCK_NONE);
    await vfs2.jUnlock(1, VFS.SQLITE_LOCK_NONE);
  });

  await test('RESERVED blocks second RESERVED (returns BUSY)', async () => {
    const vfs1 = new TestVFS('test', null, { lockPolicy: 'shared' });
    const vfs2 = new TestVFS('test', null, { lockPolicy: 'shared' });
    vfs1._registerFile(1, 'reserve-contend.db');
    vfs2._registerFile(1, 'reserve-contend.db');

    await vfs1.jLock(1, VFS.SQLITE_LOCK_SHARED);
    await vfs2.jLock(1, VFS.SQLITE_LOCK_SHARED);

    const rc1 = await vfs1.jLock(1, VFS.SQLITE_LOCK_RESERVED);
    assertEqual(rc1, VFS.SQLITE_OK, 'conn1 reserved');

    const rc2 = await vfs2.jLock(1, VFS.SQLITE_LOCK_RESERVED);
    assertEqual(rc2, VFS.SQLITE_BUSY, 'conn2 should get BUSY');

    await vfs1.jUnlock(1, VFS.SQLITE_LOCK_NONE);
    await vfs2.jUnlock(1, VFS.SQLITE_LOCK_NONE);
  });

  await test('EXCLUSIVE blocks after RESERVED holder releases', async () => {
    const vfs1 = new TestVFS('test', null, { lockPolicy: 'shared', lockTimeout: 2000 });
    vfs1._registerFile(1, 'excl-test.db');

    // Full cycle: NONE → SHARED → RESERVED → EXCLUSIVE → NONE
    assertEqual(await vfs1.jLock(1, VFS.SQLITE_LOCK_SHARED), VFS.SQLITE_OK, 'to shared');
    assertEqual(await vfs1.jLock(1, VFS.SQLITE_LOCK_RESERVED), VFS.SQLITE_OK, 'to reserved');
    assertEqual(await vfs1.jLock(1, VFS.SQLITE_LOCK_EXCLUSIVE), VFS.SQLITE_OK, 'to exclusive');
    assertEqual(await vfs1.jUnlock(1, VFS.SQLITE_LOCK_SHARED), VFS.SQLITE_OK, 'back to shared');
    assertEqual(await vfs1.jUnlock(1, VFS.SQLITE_LOCK_NONE), VFS.SQLITE_OK, 'back to none');

    const s = vfs1._getState(1);
    assertEqual(s.access, null, 'clean access');
    assertEqual(s.gate, null, 'clean gate');
    assertEqual(s.reserved, null, 'clean reserved');
    assertEqual(s.hint, null, 'clean hint');
  });
}

async function testHotJournalPath() {
  console.log('\n── Hot Journal: SHARED → EXCLUSIVE ──');
  const vfs = new TestVFS('test', null, { lockPolicy: 'shared', lockTimeout: 2000 });
  vfs._registerFile(1, 'hotjournal.db');

  await test('SHARED → EXCLUSIVE (hot journal) succeeds', async () => {
    assertEqual(await vfs.jLock(1, VFS.SQLITE_LOCK_SHARED), VFS.SQLITE_OK, 'shared');
    assertEqual(await vfs.jLock(1, VFS.SQLITE_LOCK_EXCLUSIVE), VFS.SQLITE_OK, 'exclusive');

    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_EXCLUSIVE, 'at exclusive');
    assert(typeof s.gate === 'function', 'gate held');
    assert(typeof s.access === 'function', 'access held');
  });

  await test('hot journal EXCLUSIVE → NONE cleans up', async () => {
    assertEqual(await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE), VFS.SQLITE_OK, 'to none');
    const s = vfs._getState(1);
    assertEqual(s.access, null, 'clean');
    assertEqual(s.gate, null, 'clean');
  });
}

async function testEdgeCases() {
  console.log('\n── Edge Cases ──');

  await test('double unlock to NONE is safe', async () => {
    const vfs = new TestVFS('test', null, { lockPolicy: 'shared' });
    vfs._registerFile(1, 'double-unlock.db');
    await vfs.jLock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE), VFS.SQLITE_OK, 'first');
    assertEqual(await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE), VFS.SQLITE_OK, 'second (no-op)');
  });

  await test('lock timeout returns BUSY (exclusive policy)', async () => {
    const vfs1 = new TestVFS('test', null, { lockPolicy: 'exclusive', lockTimeout: 100 });
    const vfs2 = new TestVFS('test', null, { lockPolicy: 'exclusive', lockTimeout: 100 });
    vfs1._registerFile(1, 'timeout.db');
    vfs2._registerFile(1, 'timeout.db');

    assertEqual(await vfs1.jLock(1, VFS.SQLITE_LOCK_SHARED), VFS.SQLITE_OK, 'conn1 locks');
    const rc = await vfs2.jLock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(rc, VFS.SQLITE_BUSY, 'conn2 should timeout → BUSY');

    await vfs1.jUnlock(1, VFS.SQLITE_LOCK_NONE);
  });

  await test('RESERVED → SHARED rare path', async () => {
    const vfs = new TestVFS('test', null, { lockPolicy: 'shared', lockTimeout: 2000 });
    vfs._registerFile(1, 'rare-path.db');
    await vfs.jLock(1, VFS.SQLITE_LOCK_SHARED);
    await vfs.jLock(1, VFS.SQLITE_LOCK_RESERVED);
    const rc = await vfs.jUnlock(1, VFS.SQLITE_LOCK_SHARED);
    assertEqual(rc, VFS.SQLITE_OK, 'RESERVED → SHARED');
    const s = vfs._getState(1);
    assertEqual(s.type, VFS.SQLITE_LOCK_SHARED, 'at shared');
    assert(typeof s.access === 'function', 'access re-acquired as shared');
    assertEqual(s.reserved, null, 'reserved released');
    await vfs.jUnlock(1, VFS.SQLITE_LOCK_NONE);
  });
}

// ── Run everything ────────────────────────────────────────────────
export async function runAllTests() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  WebLocksMixin Test Suite             ║');
  console.log('╚══════════════════════════════════════╝');

  results.length = 0;

  await testExclusivePolicy();
  await testSharedPolicy();
  await testSharedPolicyConcurrency();
  await testHotJournalPath();
  await testEdgeCases();

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`\n══ Summary: ${passed} passed, ${failed} failed ══`);
  if (failed > 0) {
    console.log('Failures:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    });
  }

  return { passed, failed, results };
}

// Auto-run if loaded as a script (browser)
if (typeof window !== 'undefined') {
  runAllTests();
}

