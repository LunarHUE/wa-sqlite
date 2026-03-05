import * as Comlink from 'comlink';
import * as VFS from '../src/VFS.js';
import { expect } from './helpers.ts';
import { TestContext } from './TestContext.ts';

const FILEID = 1;

export function vfs_xOpen(context: TestContext) {
  describe('vfs_xOpen', function() {
    let proxy: any, vfs: any;
    beforeEach(async function() {
      proxy = await context.create();
      vfs = proxy.vfs;
    });

    afterEach(async function() {
      await context.destroy(proxy);
    });

    it('should create a file', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE;
      rc = await vfs.jOpen('test', FILEID, openFlags, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pOpenOutput.getInt32(0, true)).to.equal(openFlags);

      const pAccessOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      rc = await vfs.jAccess('test', VFS.SQLITE_ACCESS_READWRITE, pAccessOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pAccessOutput.getInt32(0, true)).to.not.equal(0);
    });

    it('should create a database file', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_MAIN_DB;

      do {
        const nRetryOps = await proxy.module.retryOps.length;
        for (let i = 0; i < nRetryOps; i++) {
          await proxy.module.retryOps[i];
        }
        rc = await vfs.jOpen('test', 1, openFlags, pOpenOutput);
      } while (rc === VFS.SQLITE_BUSY);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pOpenOutput.getInt32(0, true)).to.equal(openFlags);

      const pAccessOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      rc = await vfs.jAccess('test', VFS.SQLITE_ACCESS_READWRITE, pAccessOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pAccessOutput.getInt32(0, true)).to.not.equal(0);
    });

    it('should not create a file', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_READWRITE;
      rc = await vfs.jOpen('test', 1, openFlags, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_CANTOPEN);

      const pAccessOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      rc = await vfs.jAccess('test', VFS.SQLITE_ACCESS_READWRITE, pAccessOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pAccessOutput.getInt32(0, true)).to.equal(0);
    });

    it('should open an existing file', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE;
      rc = await vfs.jOpen('test', FILEID, openFlags, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);

      // Close the file because some VFS implementations don't allow
      // multiple open handles.
      await vfs.jClose(FILEID);

      rc = await vfs.jOpen('test', FILEID, VFS.SQLITE_OPEN_READWRITE, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pOpenOutput.getInt32(0, true)).to.equal(VFS.SQLITE_OPEN_READWRITE);
    });

    it('should create an anonymous file', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE;
      rc = await vfs.jOpen(null, FILEID, openFlags, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pOpenOutput.getInt32(0, true)).to.equal(openFlags);
    });
  });
}
