import * as Comlink from 'comlink';
import { expect } from './helpers.ts';
import { TestContext } from './TestContext.ts';

export function sql_0004(context: TestContext) {
  const cleanup: (() => Promise<void>)[] = [];
  beforeEach(async function() {
    cleanup.splice(0);
  });

  afterEach(async function() {
    for (const fn of cleanup) {
      await fn();
    }
  });

  describe('sql_0004', function() {
    it('should recover after crash', async function() {
      const proxyA = await context.create();
      try {
        const sqlite3 = proxyA.sqlite3;
        const db = await sqlite3.open_v2('demo');
        await sqlite3.exec(db, `
          PRAGMA cache_size=0;
          CREATE TABLE t(x);
          INSERT INTO t VALUES (1), (2), (3);
        `);

        let sum: number | undefined;
        await sqlite3.exec(db, `
          SELECT sum(x) FROM t;
        `, Comlink.proxy((row: unknown[]) => sum = row[0] as number));
        expect(sum).to.equal(6);

        let check: string | undefined;
        await sqlite3.exec(db, `
          PRAGMA integrity_check;
        `, Comlink.proxy((row: unknown[]) => check = row[0] as string));
        expect(check).to.equal('ok');

        // Begin a transaction but don't commit it.
        await sqlite3.exec(db, `
          BEGIN TRANSACTION;
          WITH RECURSIVE cnt(x) AS
            (SELECT 1 UNION ALL SELECT x+1 FROM cnt LIMIT 10000)
          INSERT INTO t SELECT * FROM cnt;
        `);
      } finally {
        await context.destroy(proxyA);
      }

      await new Promise(resolve => setTimeout(resolve, 250));

      const proxyB = await context.create({ reset: false });
      try {
        const sqlite3 = proxyB.sqlite3;
        const db = await sqlite3.open_v2('demo');

        let sum: number | undefined;
        await sqlite3.exec(db, `
          SELECT sum(x) FROM t;
        `, Comlink.proxy((row: unknown[]) => sum = row[0] as number));
        expect(sum).to.equal(6);

        let check: string | undefined;
        await sqlite3.exec(db, `
          PRAGMA integrity_check;
        `, Comlink.proxy((row: unknown[]) => check = row[0] as string));
        expect(check).to.equal('ok');

        await sqlite3.exec(db, `
          INSERT INTO t VALUES (4), (5);
        `);
        await sqlite3.exec(db, `
          SELECT sum(x) FROM t;
        `, Comlink.proxy((row: unknown[]) => sum = row[0] as number));
        expect(sum).to.equal(15);
      } finally {
        await context.destroy(proxyB);
      }
    });
  });
}
