import * as Comlink from 'comlink';
import * as VFS from '../src/VFS';
import { expect } from './helpers.ts';
import { TestContext } from './TestContext.ts';

const FILEID = 1;

export function vfs_xClose(context: TestContext) {
  describe('vfs_xClose', function() {
    let proxy: any, vfs: any;
    beforeEach(async function() {
      proxy = await context.create();
      vfs = proxy.vfs;
    });

    afterEach(async function() {
      await context.destroy(proxy);
    });

    it('should leave an accessible file', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE;
      rc = await vfs.jOpen('test', FILEID, openFlags, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);

      await vfs.jClose(FILEID);

      const pAccessOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      rc = await vfs.jAccess('test', VFS.SQLITE_ACCESS_READWRITE, pAccessOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pAccessOutput.getInt32(0, true)).to.not.equal(0);
    });

    it('should delete on close', async function() {
      let rc: number;
      const pOpenOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      const openFlags = VFS.SQLITE_OPEN_CREATE | VFS.SQLITE_OPEN_READWRITE | VFS.SQLITE_OPEN_DELETEONCLOSE;
      rc = await vfs.jOpen('test', FILEID, openFlags, pOpenOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);

      const pAccessOutput = Comlink.proxy(new DataView(new ArrayBuffer(4)));
      rc = await vfs.jAccess('test', VFS.SQLITE_ACCESS_READWRITE, pAccessOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pAccessOutput.getInt32(0, true)).to.equal(1);

      await vfs.jClose(FILEID);

      rc = await vfs.jAccess('test', VFS.SQLITE_ACCESS_READWRITE, pAccessOutput);
      expect(rc).to.equal(VFS.SQLITE_OK);
      expect(pAccessOutput.getInt32(0, true)).to.equal(0);
    });
  });
}
