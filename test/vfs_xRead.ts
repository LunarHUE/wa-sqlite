import * as Comlink from 'comlink';
import * as VFS from '../src/VFS.js';
import { expect } from './helpers.ts';
import { TestContext } from './TestContext.ts';

const FILEID = 1;

export function vfs_xRead(context: TestContext) {
  describe('vfs_xRead', function() {
    let proxy: any, vfs: any;
    beforeEach(async function() {
      proxy = await context.create();
      vfs = proxy.vfs;
    });

    afterEach(async function() {
      await context.destroy(proxy);
    });

    it('should signal short read', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE;
      rc = await vfs.jOpen('test', FILEID, openFlags, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);

      const pData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const iOffset = 0;
      rc = await vfs.jWrite(FILEID, pData, iOffset);
      expect(rc).to.equal(VFS.SQLITE_OK);

      const pReadData = Comlink.proxy(new Uint8Array(pData.length * 2).fill(0xfb));
      rc = await vfs.jRead(FILEID, pReadData, iOffset);
      expect(rc).to.equal(VFS.SQLITE_IOERR_SHORT_READ);
      expect([...pReadData.subarray(0, pData.length)]).to.deep.equal([...pData]);
      expect([...pReadData.subarray(pData.length)]).to.deep.equal([...new Uint8Array(pReadData.length - pData.length)]);
    });
  });
}
