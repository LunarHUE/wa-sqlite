// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import { MemoryVFS } from './MemoryVFS';

// Sample asynchronous in-memory filesystem. This filesystem requires an
// asynchronous WebAssembly build (Asyncify or JSPI).
export class MemoryAsyncVFS extends MemoryVFS {

  static async create(name: string, module: any): Promise<MemoryAsyncVFS> {
    const vfs = new MemoryVFS(name, module);
    await vfs.isReady();
    return vfs;
  }

  constructor(name: string, module: any) {
    super(name, module);
  }

  async close(): Promise<void> {
    for (const fileId of this.mapIdToFile.keys()) {
      await this.xClose(fileId);
    }
  }

  async jOpen(name: string | null, fileId: number, flags: number, pOutFlags: DataView): Promise<number> {
    return super.jOpen(name, fileId, flags, pOutFlags) as number;
  }

  async jClose(fileId: number): Promise<number> {
    return super.jClose(fileId) as number;
  }

  async jRead(fileId: number, pData: Uint8Array, iOffset: number): Promise<number> {
    return super.jRead(fileId, pData, iOffset) as number;
  }

  async jWrite(fileId: number, pData: Uint8Array, iOffset: number): Promise<number> {
    return super.jWrite(fileId, pData, iOffset) as number;
  }

  async xTruncate(fileId: number, iSize: number): Promise<number> {
    return super.jTruncate(fileId, iSize) as number;
  }

  async jFileSize(fileId: number, pSize64: DataView): Promise<number> {
    return super.jFileSize(fileId, pSize64) as number;
  }

  async jDelete(name: string, syncDir: number): Promise<number> {
    return super.jDelete(name, syncDir) as number;
  }

  async jAccess(name: string, flags: number, pResOut: DataView): Promise<number> {
    return super.jAccess(name, flags, pResOut) as number;
  }
}
