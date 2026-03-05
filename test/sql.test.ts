import { TestContext } from './TestContext.ts';
import { sql_0001 } from './sql_0001.ts';
import { sql_0002 } from './sql_0002.ts';
import { sql_0003 } from './sql_0003.ts';
import { sql_0004 } from './sql_0004.ts';
import { sql_0005 } from './sql_0005.ts';

const ALL_BUILDS = ['default', 'asyncify', 'jspi'];
const ASYNC_BUILDS = ['asyncify', 'jspi'];

// Not all browsers support JSPI yet.
const supportsJSPI = await TestContext.supportsJSPI();

const CONFIGS = new Map<string, string[]>([
  ['', ALL_BUILDS],
  ['MemoryVFS', ALL_BUILDS],
  ['AccessHandlePoolVFS', ALL_BUILDS],
  ['OPFSCoopSyncVFS', ALL_BUILDS],
  ['MemoryAsyncVFS', ASYNC_BUILDS],
  ['IDBBatchAtomicVFS', ASYNC_BUILDS],
  ['IDBMirrorVFS', ASYNC_BUILDS],
  ['OPFSAdaptiveVFS', ASYNC_BUILDS],
  ['OPFSAnyContextVFS', ASYNC_BUILDS],
  ['OPFSPermutedVFS', ASYNC_BUILDS],
]);

const DISALLOWS_PAGE_SIZE_CHANGE = ['IDBBatchAtomicVFS', 'IDBMirrorVFS', 'OPFSPermutedVFS', 'FLOOR'];
const NOT_PERSISTENT = ['', 'MemoryVFS', 'MemoryAsyncVFS'];
const SINGLE_CONNECTION = ['', 'MemoryVFS', 'MemoryAsyncVFS', 'AccessHandlePoolVFS'];

describe('SQL', function() {
  for (const [config, builds] of CONFIGS) {
    describe(config, function() {
      for (const build of builds) {
        // Skip JSPI tests if the browser does not support it.
        if (build === 'jspi' && !supportsJSPI) continue;

        describe(build, function() {
          sqlSpecs(build, config);
        });
      }
    });
  }
});

function sqlSpecs(build: string, config: string) {
  const context = new TestContext({ build, config });

  sql_0001(context);
  sql_0002(context);
  if (!DISALLOWS_PAGE_SIZE_CHANGE.includes(config)) {
    // These tests change the page size.
    sql_0003(context);
  }
  if (!NOT_PERSISTENT.includes(config)) {
    // These tests require persistent storage.
    sql_0004(context);
  }
  if (!SINGLE_CONNECTION.includes(config)) {
    // These tests require multiple connections.
    sql_0005(context);
  }
}
