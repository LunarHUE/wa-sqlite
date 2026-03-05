import * as Comlink from 'comlink';
import { expect } from './helpers.ts';
import { TestContext } from './TestContext.ts';

export function sql_0003(context: TestContext) {
  describe('sql_0003', function() {
    let proxy: any, sqlite3: any, db: any;
    beforeEach(async function() {
      proxy = await context.create();
      sqlite3 = proxy.sqlite3;
      db = await sqlite3.open_v2('demo');
    });

    afterEach(async function() {
      await sqlite3.close(db);
      await context.destroy(proxy);
    });

    it('should vacuum to decrease page size', async function() {
      await sqlite3.exec(db, `
        PRAGMA page_size=8192;
        CREATE TABLE t AS
        WITH numbers(n) AS
          (SELECT 1 UNION ALL SELECT n + 1 FROM numbers LIMIT 10000)
          SELECT n FROM numbers;
      `);

      let pageSizeBeforeVacuum: number | undefined;
      await sqlite3.exec(db, `
        PRAGMA page_size;
      `, Comlink.proxy((row: unknown[]) => pageSizeBeforeVacuum = row[0] as number));
      expect(pageSizeBeforeVacuum).to.equal(8192);

      await sqlite3.exec(db, `
        PRAGMA page_size=4096;
        VACUUM;
      `);

      let pageSizeAfterVacuum: number | undefined;
      await sqlite3.exec(db, `
        PRAGMA page_size;
      `, Comlink.proxy((row: unknown[]) => pageSizeAfterVacuum = row[0] as number));
      expect(pageSizeAfterVacuum).to.equal(4096);

      let checkStatus: string | undefined;
      await sqlite3.exec(db, `
        PRAGMA integrity_check;
      `, Comlink.proxy((row: unknown[]) => checkStatus = row[0] as string));
      expect(checkStatus).to.equal('ok');
    });

    it('should vacuum to increase page size', async function() {
      await sqlite3.exec(db, `
        PRAGMA page_size=8192;
        CREATE TABLE t AS
        WITH numbers(n) AS
          (SELECT 1 UNION ALL SELECT n + 1 FROM numbers LIMIT 10000)
          SELECT n FROM numbers;
      `);

      let pageSizeBeforeVacuum: number | undefined;
      await sqlite3.exec(db, `
        PRAGMA page_size;
      `, Comlink.proxy((row: unknown[]) => pageSizeBeforeVacuum = row[0] as number));
      expect(pageSizeBeforeVacuum).to.equal(8192);

      await sqlite3.exec(db, `
        PRAGMA page_size=16384;
        VACUUM;
      `);

      let pageSizeAfterVacuum: number | undefined;
      await sqlite3.exec(db, `
        PRAGMA page_size;
      `, Comlink.proxy((row: unknown[]) => pageSizeAfterVacuum = row[0] as number));
      expect(pageSizeAfterVacuum).to.equal(16384);

      let checkStatus: string | undefined;
      await sqlite3.exec(db, `
        PRAGMA integrity_check;
      `, Comlink.proxy((row: unknown[]) => checkStatus = row[0] as string));
      expect(checkStatus).to.equal('ok');
    });
  });
}
