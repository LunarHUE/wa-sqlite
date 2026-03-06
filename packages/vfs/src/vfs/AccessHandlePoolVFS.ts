// Copyright 2023 Roy T. Hashimoto. All Rights Reserved.
import { FacadeVFS } from '../FacadeVFS';
import * as VFS from '../VFS';

const SECTOR_SIZE = 4096;

const HEADER_MAX_PATH_SIZE = 512;
const HEADER_FLAGS_SIZE = 4;
const HEADER_DIGEST_SIZE = 8;
const HEADER_CORPUS_SIZE = HEADER_MAX_PATH_SIZE + HEADER_FLAGS_SIZE;
const HEADER_OFFSET_FLAGS = HEADER_MAX_PATH_SIZE;
const HEADER_OFFSET_DIGEST = HEADER_CORPUS_SIZE;
const HEADER_OFFSET_DATA = SECTOR_SIZE;

const PERSISTENT_FILE_TYPES =
  VFS.SQLITE_OPEN_MAIN_DB |
  VFS.SQLITE_OPEN_MAIN_JOURNAL |
  VFS.SQLITE_OPEN_SUPER_JOURNAL |
  VFS.SQLITE_OPEN_WAL;

const DEFAULT_CAPACITY = 6;

export class AccessHandlePoolVFS extends FacadeVFS {
  log: any = null;

  #directoryPath: string;
  #directoryHandle: FileSystemDirectoryHandle;

  #mapAccessHandleToName: Map<FileSystemSyncAccessHandle, string> = new Map();
  #mapPathToAccessHandle: Map<string, FileSystemSyncAccessHandle> = new Map();
  #availableAccessHandles: Set<FileSystemSyncAccessHandle> = new Set();

  #mapIdToFile: Map<number, { path: string; flags: number; accessHandle: FileSystemSyncAccessHandle }> = new Map();

  static async create(name: string, module: any): Promise<AccessHandlePoolVFS> {
    const vfs = new AccessHandlePoolVFS(name, module);
    await vfs.isReady();
    return vfs;
  }

  constructor(name: string, module: any) {
    super(name, module);
    this.#directoryPath = name;
  }

  jOpen(zName: string | null, fileId: number, flags: number, pOutFlags: DataView): number {
    try {
      const path = zName ? this.#getPath(zName) : Math.random().toString(36);
      let accessHandle = this.#mapPathToAccessHandle.get(path);
      if (!accessHandle && (flags & VFS.SQLITE_OPEN_CREATE)) {
        if (this.getSize() < this.getCapacity()) {
          ([accessHandle] = this.#availableAccessHandles.keys());
          this.#setAssociatedPath(accessHandle, path, flags);
        } else {
          throw new Error('cannot create file');
        }
      }
      if (!accessHandle) {
        throw new Error('file not found');
      }
      const file = { path, flags, accessHandle };
      this.#mapIdToFile.set(fileId, file);
      pOutFlags.setInt32(0, flags, true);
      return VFS.SQLITE_OK;
    } catch (e) {
      console.error((e as Error).message);
      return VFS.SQLITE_CANTOPEN;
    }
  }

  jClose(fileId: number): number {
    const file = this.#mapIdToFile.get(fileId);
    if (file) {
      file.accessHandle.flush();
      this.#mapIdToFile.delete(fileId);
      if (file.flags & VFS.SQLITE_OPEN_DELETEONCLOSE) {
        this.#deletePath(file.path);
      }
    }
    return VFS.SQLITE_OK;
  }

  jRead(fileId: number, pData: Uint8Array, iOffset: number): number {
    const file = this.#mapIdToFile.get(fileId);
    const nBytes = file.accessHandle.read(pData.subarray(), { at: HEADER_OFFSET_DATA + iOffset });
    if (nBytes < pData.byteLength) {
      pData.fill(0, nBytes, pData.byteLength);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }
    return VFS.SQLITE_OK;
  }

  jWrite(fileId: number, pData: Uint8Array, iOffset: number): number {
    const file = this.#mapIdToFile.get(fileId);
    const nBytes = file.accessHandle.write(pData.subarray(), { at: HEADER_OFFSET_DATA + iOffset });
    return nBytes === pData.byteLength ? VFS.SQLITE_OK : VFS.SQLITE_IOERR;
  }

  jTruncate(fileId: number, iSize: number): number {
    const file = this.#mapIdToFile.get(fileId);
    file.accessHandle.truncate(HEADER_OFFSET_DATA + iSize);
    return VFS.SQLITE_OK;
  }

  jSync(fileId: number, flags: number): number {
    const file = this.#mapIdToFile.get(fileId);
    file.accessHandle.flush();
    return VFS.SQLITE_OK;
  }

  jFileSize(fileId: number, pSize64: DataView): number {
    const file = this.#mapIdToFile.get(fileId);
    const size = file.accessHandle.getSize() - HEADER_OFFSET_DATA;
    pSize64.setBigInt64(0, BigInt(size), true);
    return VFS.SQLITE_OK;
  }

  jSectorSize(fileId: number): number {
    return SECTOR_SIZE;
  }

  jDeviceCharacteristics(fileId: number): number {
    return VFS.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN;
  }

  jAccess(zName: string, flags: number, pResOut: DataView): number {
    const path = this.#getPath(zName);
    pResOut.setInt32(0, this.#mapPathToAccessHandle.has(path) ? 1 : 0, true);
    return VFS.SQLITE_OK;
  }

  jDelete(zName: string, syncDir: number): number {
    const path = this.#getPath(zName);
    this.#deletePath(path);
    return VFS.SQLITE_OK;
  }

  async close(): Promise<void> {
    await this.#releaseAccessHandles();
  }

  async isReady(): Promise<boolean> {
    if (!this.#directoryHandle) {
      let handle = await navigator.storage.getDirectory();
      for (const d of this.#directoryPath.split('/')) {
        if (d) {
          handle = await handle.getDirectoryHandle(d, { create: true });
        }
      }
      this.#directoryHandle = handle;

      await this.#acquireAccessHandles();
      if (this.getCapacity() === 0) {
        await this.addCapacity(DEFAULT_CAPACITY);
      }
    }
    return true;
  }

  getSize(): number {
    return this.#mapPathToAccessHandle.size;
  }

  getCapacity(): number {
    return this.#mapAccessHandleToName.size;
  }

  async addCapacity(n: number): Promise<number> {
    for (let i = 0; i < n; ++i) {
      const name = Math.random().toString(36).replace('0.', '');
      const handle = await this.#directoryHandle.getFileHandle(name, { create: true });
      const accessHandle = await handle.createSyncAccessHandle();
      this.#mapAccessHandleToName.set(accessHandle, name);
      this.#setAssociatedPath(accessHandle, '', 0);
    }
    return n;
  }

  async removeCapacity(n: number): Promise<number> {
    let nRemoved = 0;
    for (const accessHandle of Array.from(this.#availableAccessHandles)) {
      if (nRemoved == n || this.getSize() === this.getCapacity()) return nRemoved;
      const name = this.#mapAccessHandleToName.get(accessHandle);
      await accessHandle.close();
      await this.#directoryHandle.removeEntry(name);
      this.#mapAccessHandleToName.delete(accessHandle);
      this.#availableAccessHandles.delete(accessHandle);
      ++nRemoved;
    }
    return nRemoved;
  }

  async #acquireAccessHandles(): Promise<void> {
    const files: [string, FileSystemFileHandle][] = [];
    // @ts-ignore
    for await (const [name, handle] of this.#directoryHandle) {
      if (handle.kind === 'file') {
        files.push([name, handle]);
      }
    }

    await Promise.all(files.map(async ([name, handle]) => {
      const accessHandle = await handle.createSyncAccessHandle();
      this.#mapAccessHandleToName.set(accessHandle, name);
      const path = this.#getAssociatedPath(accessHandle);
      if (path) {
        this.#mapPathToAccessHandle.set(path, accessHandle);
      } else {
        this.#availableAccessHandles.add(accessHandle);
      }
    }));
  }

  #releaseAccessHandles(): void {
    for (const accessHandle of this.#mapAccessHandleToName.keys()) {
      accessHandle.close();
    }
    this.#mapAccessHandleToName.clear();
    this.#mapPathToAccessHandle.clear();
    this.#availableAccessHandles.clear();
  }

  #getAssociatedPath(accessHandle: FileSystemSyncAccessHandle): string {
    const corpus = new Uint8Array(HEADER_CORPUS_SIZE);
    accessHandle.read(corpus, { at: 0 });

    const dataView = new DataView(corpus.buffer, corpus.byteOffset);
    const flags = dataView.getUint32(HEADER_OFFSET_FLAGS);
    if (corpus[0] &&
        ((flags & VFS.SQLITE_OPEN_DELETEONCLOSE) ||
         (flags & PERSISTENT_FILE_TYPES) === 0)) {
      console.warn(`Remove file with unexpected flags ${flags.toString(16)}`);
      this.#setAssociatedPath(accessHandle, '', 0);
      return '';
    }

    const fileDigest = new Uint32Array(HEADER_DIGEST_SIZE / 4);
    accessHandle.read(fileDigest, { at: HEADER_OFFSET_DIGEST });

    const computedDigest = this.#computeDigest(corpus);
    if (fileDigest.every((value, i) => value === computedDigest[i])) {
      const pathBytes = corpus.findIndex(value => value === 0);
      if (pathBytes === 0) {
        accessHandle.truncate(HEADER_OFFSET_DATA);
      }
      return new TextDecoder().decode(corpus.subarray(0, pathBytes));
    } else {
      console.warn('Disassociating file with bad digest.');
      this.#setAssociatedPath(accessHandle, '', 0);
      return '';
    }
  }

  #setAssociatedPath(accessHandle: FileSystemSyncAccessHandle, path: string, flags: number): void {
    const corpus = new Uint8Array(HEADER_CORPUS_SIZE);
    const encodedResult = new TextEncoder().encodeInto(path, corpus);
    if (encodedResult.written >= HEADER_MAX_PATH_SIZE) {
      throw new Error('path too long');
    }

    const dataView = new DataView(corpus.buffer, corpus.byteOffset);
    dataView.setUint32(HEADER_OFFSET_FLAGS, flags);

    const digest = this.#computeDigest(corpus);
    accessHandle.write(corpus, { at: 0 });
    accessHandle.write(digest, { at: HEADER_OFFSET_DIGEST });
    accessHandle.flush();

    if (path) {
      this.#mapPathToAccessHandle.set(path, accessHandle);
      this.#availableAccessHandles.delete(accessHandle);
    } else {
      accessHandle.truncate(HEADER_OFFSET_DATA);
      this.#availableAccessHandles.add(accessHandle);
    }
  }

  #computeDigest(corpus: Uint8Array): Uint32Array {
    if (!corpus[0]) {
      return new Uint32Array([0xfecc5f80, 0xaccec037]);
    }

    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (const value of corpus) {
      h1 = Math.imul(h1 ^ value, 2654435761);
      h2 = Math.imul(h2 ^ value, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return new Uint32Array([h1 >>> 0, h2 >>> 0]);
  }

  #getPath(nameOrURL: string | URL): string {
    const url = typeof nameOrURL === 'string' ?
      new URL(nameOrURL, 'file://localhost/') :
      nameOrURL;
    return url.pathname;
  }

  #deletePath(path: string): void {
    const accessHandle = this.#mapPathToAccessHandle.get(path);
    if (accessHandle) {
      this.#mapPathToAccessHandle.delete(path);
      this.#setAssociatedPath(accessHandle, '', 0);
    }
  }
}
