import * as Comlink from 'comlink';
import * as SQLite from '../src/sqlite-api.js';
import { expect, expectAsync } from './helpers.ts';
import { TestContext } from './TestContext.ts';

export function api_exec(context: TestContext) {
  describe('exec', function() {
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

    it('should execute a query', async function() {
      let rc: number;
      rc = await sqlite3.exec(db, 'CREATE TABLE t(x)');
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.exec(db, 'INSERT INTO t VALUES (1), (2), (3)');
      expect(rc).to.equal(SQLite.SQLITE_OK);

      const nChanges = await sqlite3.changes(db);
      expect(nChanges).to.equal(3);
    });

    it('should execute multiple queries', async function() {
      let rc: number;
      rc = await sqlite3.exec(db, `
        CREATE TABLE t(x);
        INSERT INTO t VALUES (1), (2), (3);
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(await sqlite3.changes(db)).to.equal(3);
    });

    it('should return query results via callback', async function() {
      const results: { rows: unknown[][], columns: string[] } = { rows: [], columns: [] };
      const rc = await sqlite3.exec(db, `
        CREATE TABLE t(x);
        INSERT INTO t VALUES (1), (2), (3);
        SELECT * FROM t ORDER BY x;
      `, Comlink.proxy((row: unknown[], columns: string[]) => {
        if (columns.length) {
          results.columns = columns;
          results.rows.push(row);
        }
      }));
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(results).to.deep.equal({ columns: ['x'], rows: [[1], [2], [3]] });
    });

    it('should allow a transaction to span multiple calls', async function() {
      let rc: number;
      rc = await sqlite3.get_autocommit(db);
      expect(rc).to.not.equal(0);

      rc = await sqlite3.exec(db, 'BEGIN TRANSACTION');
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.get_autocommit(db);
      expect(rc).to.equal(0);

      rc = await sqlite3.exec(db, `
        CREATE TABLE t AS
        WITH RECURSIVE cnt(x) AS (
          SELECT 1
          UNION ALL
          SELECT x+1 FROM cnt
            LIMIT 100
        )
        SELECT x FROM cnt;
    `);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.get_autocommit(db);
      expect(rc).to.equal(0);

      rc = await sqlite3.exec(db, 'COMMIT');
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.get_autocommit(db);
      expect(rc).to.not.equal(0);
    });
  });
}
