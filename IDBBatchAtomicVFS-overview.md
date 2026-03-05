# Project Overview

This is `@lunarhue/react-native-web-wa-sqlite` — a fork/adaptation of [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) providing WebAssembly SQLite with pluggable VFS (Virtual File System) implementations for browser environments.

---

## Architecture Layers

```
VFS.Base          — Raw C-level SQLite interface (xOpen, xRead, xWrite, ...)
    └── FacadeVFS — Translates C primitives → JS-friendly types (jOpen, jRead, ...)
            └── WebLocksMixin — Optional mixin adding Web Locks API concurrency
                    └── Concrete VFS implementations
```

- **`VFS.Base`** (`src/VFS.js`) — thin base class matching the raw SQLite VFS method signatures (pointers, raw numbers)
- **`FacadeVFS`** (`src/FacadeVFS.js`) — the practical base. Decodes C strings, wraps pointers as `DataView`/`Uint8Array`, and dispatches to `jOpen`/`jRead`/etc. Also handles Wasm memory resize safety via `Uint8ArrayProxy` and `DataViewProxy`
- **`WebLocksMixin`** (`src/WebLocksMixin.js`) — composable mixin using the Web Locks API to implement SQLite's shared/reserved/exclusive lock protocol across multiple connections

---

## VFS Comparison Summary

| VFS | Storage | Multi-connection | Sync build | All contexts | Special trait |
|-----|---------|-----------------|------------|--------------|---------------|
| **MemoryVFS** | RAM | No | Yes | Yes | Minimal reference impl |
| **MemoryAsyncVFS** | RAM | No | No | Yes | Same but async, for testing |
| **IDBBatchAtomicVFS** | IndexedDB | Yes | No | **Yes** | Batch atomic writes, crash recovery |
| **IDBMirrorVFS** | RAM + IDB | Yes | No | Yes | Faster IDB; requires DB fits in RAM |
| **AccessHandlePoolVFS** | OPFS | No | **Yes** | Worker only | Fully sync; allows WAL mode |
| **OPFSAdaptiveVFS** | OPFS | Yes | No | Worker only | Lazy handle close for concurrency |
| **OPFSCoopSyncVFS** | OPFS | Yes | **Yes** | Worker only | Sync OPFS with cooperative locking |
| **OPFSPermutedVFS** | OPFS + IDB | Yes | No | Worker only | WAL-like, high read concurrency |

---

## How IDBBatchAtomicVFS Works

### Key Design: Batch Atomic Writes

`jDeviceCharacteristics` returns `SQLITE_IOCAP_BATCH_ATOMIC`. This tells SQLite the storage can atomically commit an arbitrary set of page changes as a unit — so **no external journal file is needed**. The journal lives in SQLite's page cache instead (requires sufficient `cache_size`).

### Storage Schema (IndexedDB)

Two object stores:
- **`metadata`** — one record per file: `{ name, fileSize, version, [pendingVersion] }`
- **`blocks`** — one record per page version: `{ path, offset: -byteOffset, version, data }`

The offset is stored **negated** so IDB key ranges like `[path, -fileOffset]` work correctly for range queries fetching the block at or after a given position.

### Write Transaction Lifecycle

```
jWrite()       — synchronous; queues IDB puts without awaiting
                 On first write: stamps metadata with pendingVersion (crash marker)
                 decrements version number, saves rollback snapshot

SQLITE_FCNTL_SYNC (commit path)
               — writes final metadata, deletes old page versions

SQLITE_FCNTL_ROLLBACK_ATOMIC_WRITE
               — deletes newly written blocks, restores metadata from rollback snapshot

jSync/jClose() — awaits IDBContext.sync() to flush queued operations
```

### Crash Recovery

If a process dies mid-transaction, `metadata.pendingVersion` is left set. The next connection's `jLock(SHARED)` detects this and scans for stale blocks (version < current) to delete them before proceeding.

### IDBContext — Transaction Chaining

`IDBContext` (`src/examples/IDBBatchAtomicVFS.js:578`) is the heart of the IDB interaction:

- `q(fn, mode)` — enqueues operations into a sequential `#chain` promise, and **reuses the currently-open IDB transaction** when the mode and durability match, avoiding unnecessary transaction boundaries
- `sync(durable)` — awaits `#chain` (all ops queued), and optionally awaits `#txComplete` (actual IDB commit) for full durability
- `jWrite` fires IDB puts without awaiting — keeping the synchronous SQLite write path fast; durability is deferred to `jSync`/`jClose`

### Multi-connection via WebLocksMixin

`IDBBatchAtomicVFS extends WebLocksMixin(FacadeVFS)`. The mixin implements SQLite's lock escalation (SHARED → RESERVED → EXCLUSIVE) using the Web Locks API, allowing safe concurrent access from multiple tabs/workers while falling back on IDB version metadata to refresh state when acquiring a shared lock.

### vs. MemoryVFS (simplest baseline)

- MemoryVFS stores pages in a single `ArrayBuffer` per file — no persistence, no locking, no async, no versioning. It's the minimal implementation to understand the interface.
- IDBBatchAtomicVFS adds: async IDB persistence, versioned block storage, crash recovery, multi-connection locking, configurable durability, and the batch-atomic protocol.

### vs. OPFS variants

- OPFS VFSes map more directly to a traditional file system (byte-range reads/writes to a real file), which is simpler conceptually but restricted to Worker contexts and requires explicit concurrency management with access handles.
- IDBBatchAtomicVFS trades that simplicity for **universal context support** (Window, Worker, SharedWorker, Service Worker, extensions) at the cost of not being filesystem-transparent and not supporting page size changes after creation.
