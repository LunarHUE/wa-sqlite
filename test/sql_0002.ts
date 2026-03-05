import * as Comlink from 'comlink';
import { expect } from './helpers.ts';
import { TestContext } from './TestContext.ts';

export function sql_0002(context: TestContext) {
  describe('sql_0002', function() {
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

    it('should vacuum to minimize page count', async function() {
      await sqlite3.exec(db, `
        CREATE TABLE t AS
        WITH numbers(n) AS
          (SELECT 1 UNION ALL SELECT n + 1 FROM numbers LIMIT 10000)
          SELECT n FROM numbers;
      `);

      let nPagesBeforeVacuum: number | undefined;
      await sqlite3.exec(db, `
        PRAGMA page_count;
      `, Comlink.proxy((row: unknown[]) => nPagesBeforeVacuum = row[0] as number));

      await sqlite3.exec(db, `
        DELETE FROM t WHERE sqrt(n) != floor(sqrt(n));
      `);

      await sqlite3.exec(db, `
        VACUUM;
      `);

      let nPagesAfterVacuum: number | undefined;
      await sqlite3.exec(db, `
        PRAGMA page_count;
      `, Comlink.proxy((row: unknown[]) => nPagesAfterVacuum = row[0] as number));

      expect(nPagesAfterVacuum).to.be.below(nPagesBeforeVacuum!);

      let checkStatus: string | undefined;
      await sqlite3.exec(db, `
        PRAGMA integrity_check;
      `, Comlink.proxy((row: unknown[]) => checkStatus = row[0] as string));
      expect(checkStatus).to.equal('ok');
    });
  });
}
