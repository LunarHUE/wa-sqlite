import { TestContext } from './TestContext.ts';
import { vfs_xOpen } from './vfs_xOpen.ts';
import { vfs_xAccess } from './vfs_xAccess.ts';
import { vfs_xClose } from './vfs_xClose.ts';
import { vfs_xRead } from './vfs_xRead.ts';
import { vfs_xWrite } from './vfs_xWrite.ts';

const CONFIG = 'IDBMirrorVFS';
const BUILDS = ['asyncify', 'jspi'];

const supportsJSPI = await TestContext.supportsJSPI();

describe(CONFIG, function() {
  for (const build of BUILDS) {
    if (build === 'jspi' && !supportsJSPI) return;

    describe(build, function() {
      const context = new TestContext({ build, config: CONFIG });

      vfs_xAccess(context);
      vfs_xOpen(context);
      vfs_xClose(context);
      vfs_xRead(context);
      vfs_xWrite(context);
    });
  }
});
