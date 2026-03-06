// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
import * as VFS from './VFS';

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

// Convenience base class for a JavaScript VFS.
// The raw xOpen, xRead, etc. function signatures receive only C primitives
// which aren't easy to work with. This class provides corresponding calls
// like jOpen, jRead, etc., which receive JavaScript-friendlier arguments
// such as string, Uint8Array, and DataView.
export class FacadeVFS extends VFS.Base {
  constructor(name: string, module: any) {
    super(name, module);
  }

  hasAsyncMethod(methodName: string): boolean {
    // The input argument is a string like "xOpen", so convert to "jOpen".
    // Then check if the method exists and is async.
    const jMethodName = `j${methodName.slice(1)}`;
    return (this as any)[jMethodName] instanceof AsyncFunction;
  }

  getFilename(pFile: number): string {
    throw new Error('unimplemented');
  }

  jOpen(filename: string | null, pFile: number, flags: number, pOutFlags: DataView): number | Promise<number> {
    return VFS.SQLITE_CANTOPEN;
  }

  jDelete(filename: string, syncDir: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jAccess(filename: string, flags: number, pResOut: DataView): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jFullPathname(filename: string, zOut: Uint8Array): number | Promise<number> {
    // Copy the filename to the output buffer.
    const { read, written } = new TextEncoder().encodeInto(filename, zOut);
    if (read < filename.length) return VFS.SQLITE_IOERR;
    if (written >= zOut.length) return VFS.SQLITE_IOERR;
    zOut[written] = 0;
    return VFS.SQLITE_OK;
  }

  jGetLastError(zBuf: Uint8Array): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jClose(pFile: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jRead(pFile: number, pData: Uint8Array, iOffset: number): number | Promise<number> {
    pData.fill(0);
    return VFS.SQLITE_IOERR_SHORT_READ;
  }

  jWrite(pFile: number, pData: Uint8Array, iOffset: number): number | Promise<number> {
    return VFS.SQLITE_IOERR_WRITE;
  }

  jTruncate(pFile: number, size: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jSync(pFile: number, flags: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jFileSize(pFile: number, pSize: DataView): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jLock(pFile: number, lockType: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jUnlock(pFile: number, lockType: number): number | Promise<number> {
    return VFS.SQLITE_OK;
  }

  jCheckReservedLock(pFile: number, pResOut: DataView): number | Promise<number> {
    pResOut.setInt32(0, 0, true);
    return VFS.SQLITE_OK;
  }

  jFileControl(pFile: number, op: number, pArg: DataView): number | Promise<number> {
    return VFS.SQLITE_NOTFOUND;
  }

  jSectorSize(pFile: number): number | Promise<number> {
    return super.xSectorSize(pFile);
  }

  jDeviceCharacteristics(pFile: number): number | Promise<number> {
    return 0;
  }

  xOpen(pVfs: number, zName: number, pFile: number, flags: number, pOutFlags: number): number | Promise<number> {
    const filename = this.#decodeFilename(zName, flags);
    const pOutFlagsView = this.#makeTypedDataView('Int32', pOutFlags);
    (this as any)['log']?.('jOpen', filename, pFile, '0x' + flags.toString(16));
    return this.jOpen(filename, pFile, flags, pOutFlagsView);
  }

  xDelete(pVfs: number, zName: number, syncDir: number): number | Promise<number> {
    const filename = this._module.UTF8ToString(zName);
    (this as any)['log']?.('jDelete', filename, syncDir);
    return this.jDelete(filename, syncDir);
  }

  xAccess(pVfs: number, zName: number, flags: number, pResOut: number): number | Promise<number> {
    const filename = this._module.UTF8ToString(zName);
    const pResOutView = this.#makeTypedDataView('Int32', pResOut);
    (this as any)['log']?.('jAccess', filename, flags);
    return this.jAccess(filename, flags, pResOutView);
  }

  xFullPathname(pVfs: number, zName: number, nOut: number, zOut: number): number | Promise<number> {
    const filename = this._module.UTF8ToString(zName);
    const zOutArray = this._module.HEAPU8.subarray(zOut, zOut + nOut);
    (this as any)['log']?.('jFullPathname', filename, nOut);
    return this.jFullPathname(filename, zOutArray);
  }

  xGetLastError(pVfs: number, nBuf: number, zBuf: number): number | Promise<number> {
    const zBufArray = this._module.HEAPU8.subarray(zBuf, zBuf + nBuf);
    (this as any)['log']?.('jGetLastError', nBuf);
    return this.jGetLastError(zBufArray);
  }

  xClose(pFile: number): number | Promise<number> {
    (this as any)['log']?.('jClose', pFile);
    return this.jClose(pFile);
  }

  xRead(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number | Promise<number> {
    const pDataArray = this.#makeDataArray(pData, iAmt);
    const iOffset = delegalize(iOffsetLo, iOffsetHi);
    (this as any)['log']?.('jRead', pFile, iAmt, iOffset);
    return this.jRead(pFile, pDataArray, iOffset);
  }

  xWrite(pFile: number, pData: number, iAmt: number, iOffsetLo: number, iOffsetHi: number): number | Promise<number> {
    const pDataArray = this.#makeDataArray(pData, iAmt);
    const iOffset = delegalize(iOffsetLo, iOffsetHi);
    (this as any)['log']?.('jWrite', pFile, pDataArray, iOffset);
    return this.jWrite(pFile, pDataArray, iOffset);
  }

  xTruncate(pFile: number, sizeLo: number, sizeHi: number): number | Promise<number> {
    const size = delegalize(sizeLo, sizeHi);
    (this as any)['log']?.('jTruncate', pFile, size);
    return this.jTruncate(pFile, size);
  }

  xSync(pFile: number, flags: number): number | Promise<number> {
    (this as any)['log']?.('jSync', pFile, flags);
    return this.jSync(pFile, flags);
  }

  xFileSize(pFile: number, pSize: number): number | Promise<number> {
    const pSizeView = this.#makeTypedDataView('BigInt64', pSize);
    (this as any)['log']?.('jFileSize', pFile);
    return this.jFileSize(pFile, pSizeView);
  }

  xLock(pFile: number, lockType: number): number | Promise<number> {
    (this as any)['log']?.('jLock', pFile, lockType);
    return this.jLock(pFile, lockType);
  }

  xUnlock(pFile: number, lockType: number): number | Promise<number> {
    (this as any)['log']?.('jUnlock', pFile, lockType);
    return this.jUnlock(pFile, lockType);
  }

  xCheckReservedLock(pFile: number, pResOut: number): number | Promise<number> {
    const pResOutView = this.#makeTypedDataView('Int32', pResOut);
    (this as any)['log']?.('jCheckReservedLock', pFile);
    return this.jCheckReservedLock(pFile, pResOutView);
  }

  xFileControl(pFile: number, op: number, pArg: number): number | Promise<number> {
    const pArgView = new DataView(
      this._module.HEAPU8.buffer,
      this._module.HEAPU8.byteOffset + pArg);
    (this as any)['log']?.('jFileControl', pFile, op, pArgView);
    return this.jFileControl(pFile, op, pArgView);
  }

  xSectorSize(pFile: number): number | Promise<number> {
    (this as any)['log']?.('jSectorSize', pFile);
    return this.jSectorSize(pFile);
  }

  xDeviceCharacteristics(pFile: number): number | Promise<number> {
    (this as any)['log']?.('jDeviceCharacteristics', pFile);
    return this.jDeviceCharacteristics(pFile);
  }

  // Wrapped DataView for pointer arguments.
  // Pointers to a single value are passed using a DataView-like class.
  // This wrapper class prevents use of incorrect type or endianness, and
  // reacquires the underlying buffer when the WebAssembly memory is resized.
  #makeTypedDataView(type: 'Int32' | 'BigInt64', byteOffset: number): DataView {
    // @ts-ignore
    return new DataViewProxy(this._module, byteOffset, type);
  }

  // Wrapped Uint8Array for buffer arguments.
  // Memory blocks are passed as a Uint8Array-like class. This wrapper
  // class reacquires the underlying buffer when the WebAssembly memory
  // is resized.
  #makeDataArray(byteOffset: number, byteLength: number): Uint8Array {
    // @ts-ignore
    return new Uint8ArrayProxy(this._module, byteOffset, byteLength);
  }

  #decodeFilename(zName: number, flags: number): string | null {
    if (flags & VFS.SQLITE_OPEN_URI) {
      // The first null-terminated string is the URI path. Subsequent
      // strings are query parameter keys and values.
      // https://www.sqlite.org/c3ref/open.html#urifilenamesinsqlite3open
      let pName = zName;
      let state: number | null = 1;
      const charCodes: number[] = [];
      while (state) {
        const charCode = this._module.HEAPU8[pName++];
        if (charCode) {
          charCodes.push(charCode);
        } else {
          if (!this._module.HEAPU8[pName]) state = null;
          switch (state) {
            case 1: // path
              charCodes.push('?'.charCodeAt(0));
              state = 2;
              break;
            case 2: // key
              charCodes.push('='.charCodeAt(0));
              state = 3;
              break;
            case 3: // value
              charCodes.push('&'.charCodeAt(0));
              state = 2;
              break;
          }
        }
      }
      return new TextDecoder().decode(new Uint8Array(charCodes));
    }
    return zName ? this._module.UTF8ToString(zName) : null;
  }
}

// Emscripten "legalizes" 64-bit integer arguments by passing them as
// two 32-bit signed integers.
function delegalize(lo32: number, hi32: number): number {
  return (hi32 * 0x100000000) + lo32 + (lo32 < 0 ? 2**32 : 0);
}

// This class provides a Uint8Array-like interface for a WebAssembly memory
// buffer. It is used to access memory blocks passed as arguments to
// xRead, xWrite, etc. The class reacquires the underlying buffer when the
// WebAssembly memory is resized, which can happen when the memory is
// detached and resized by the WebAssembly module.
class Uint8ArrayProxy {
  #module: any;
  byteOffset: number;
  byteLength: number;
  length: number;

  #_array = new Uint8Array();
  get #array(): Uint8Array {
    if (this.#_array.buffer.byteLength === 0) {
      this.#_array = this.#module.HEAPU8.subarray(
        this.byteOffset,
        this.byteOffset + this.byteLength);
    }
    return this.#_array;
  }

  constructor(module: any, byteOffset: number, byteLength: number) {
    this.#module = module;
    this.byteOffset = byteOffset;
    this.length = this.byteLength = byteLength;
  }

  get buffer(): ArrayBuffer { return this.#array.buffer as ArrayBuffer; }

  at(index: number) { return this.#array.at(index); }
  copyWithin(target: number, start: number, end?: number) { this.#array.copyWithin(target, start, end); }
  entries() { return this.#array.entries(); }
  every(predicate: any) { return this.#array.every(predicate); }
  fill(value: number, start?: number, end?: number) { this.#array.fill(value, start, end); }
  filter(predicate: any) { return this.#array.filter(predicate); }
  find(predicate: any) { return this.#array.find(predicate); }
  findIndex(predicate: any) { return this.#array.findIndex(predicate); }
  findLast(predicate: any) { return (this.#array as any).findLast(predicate); }
  findLastIndex(predicate: any) { return (this.#array as any).findLastIndex(predicate); }
  forEach(callback: any) { this.#array.forEach(callback); }
  includes(value: number, start?: number) { return this.#array.includes(value, start); }
  indexOf(value: number, start?: number) { return this.#array.indexOf(value, start); }
  join(separator?: string) { return this.#array.join(separator); }
  keys() { return this.#array.keys(); }
  lastIndexOf(value: number, start?: number) { return this.#array.lastIndexOf(value, start); }
  map(callback: any) { return this.#array.map(callback); }
  reduce(callback: any, initialValue?: any) { return this.#array.reduce(callback, initialValue); }
  reduceRight(callback: any, initialValue?: any) { return this.#array.reduceRight(callback, initialValue); }
  reverse() { this.#array.reverse(); }
  set(array: ArrayLike<number>, offset?: number) { this.#array.set(array, offset); }
  slice(start?: number, end?: number) { return this.#array.slice(start, end); }
  some(predicate: any) { return this.#array.some(predicate); }
  sort(compareFn?: any) { this.#array.sort(compareFn); }
  subarray(begin?: number, end?: number) { return this.#array.subarray(begin, end); }
  toLocaleString(locales?: any, options?: any) { return this.#array.toLocaleString(locales, options); }
  toReversed() { return (this.#array as any).toReversed(); }
  toSorted(compareFn?: any) { return (this.#array as any).toSorted(compareFn); }
  toString() { return this.#array.toString(); }
  values() { return this.#array.values(); }
  with(index: number, value: number) { return (this.#array as any).with(index, value); }
  [Symbol.iterator]() { return this.#array[Symbol.iterator](); }
}

// This class provides a DataView-like interface for a WebAssembly memory
// buffer, restricted to either Int32 or BigInt64 types. It also reacquires
// the underlying buffer when the WebAssembly memory is resized.
class DataViewProxy {
  #module: any;
  #type: 'Int32' | 'BigInt64';
  byteOffset: number;

  #_view = new DataView(new ArrayBuffer(0));
  get #view(): DataView {
    if (this.#_view.buffer.byteLength === 0) {
      this.#_view = new DataView(
        this.#module.HEAPU8.buffer,
        this.#module.HEAPU8.byteOffset + this.byteOffset);
    }
    return this.#_view;
  }

  constructor(module: any, byteOffset: number, type: 'Int32' | 'BigInt64') {
    this.#module = module;
    this.byteOffset = byteOffset;
    this.#type = type;
  }

  get buffer(): ArrayBuffer { return this.#view.buffer as ArrayBuffer; }
  get byteLength(): number { return this.#type === 'Int32' ? 4 : 8; }

  getInt32(byteOffset: number, littleEndian: boolean): number {
    if (this.#type !== 'Int32') throw new Error('invalid type');
    if (!littleEndian) throw new Error('must be little endian');
    return this.#view.getInt32(byteOffset, littleEndian);
  }
  setInt32(byteOffset: number, value: number, littleEndian: boolean): void {
    if (this.#type !== 'Int32') throw new Error('invalid type');
    if (!littleEndian) throw new Error('must be little endian');
    this.#view.setInt32(byteOffset, value, littleEndian);
  }
  getBigInt64(byteOffset: number, littleEndian: boolean): bigint {
    if (this.#type !== 'BigInt64') throw new Error('invalid type');
    if (!littleEndian) throw new Error('must be little endian');
    return this.#view.getBigInt64(byteOffset, littleEndian);
  }
  setBigInt64(byteOffset: number, value: bigint, littleEndian: boolean): void {
    if (this.#type !== 'BigInt64') throw new Error('invalid type');
    if (!littleEndian) throw new Error('must be little endian');
    this.#view.setBigInt64(byteOffset, value, littleEndian);
  }
}
