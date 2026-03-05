import { TestContext } from './TestContext.ts';
import * as SQLite from '../src/sqlite-api.js';
import { expect, expectAsync } from './helpers.ts';

const BUILDS = new Map([
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const supportsJSPI = await TestContext.supportsJSPI();

for (const [key, buildPath] of BUILDS) {
  if (key === 'jspi' && !supportsJSPI) continue;

  const { default: factory } = await import(buildPath);
  const buildDir = new URL(buildPath, import.meta.url).href.replace(/\/[^/]*$/, '/');
  const sqlite3 = await (factory as any)({
    locateFile: (path: string) => buildDir + path,
  }).then((module: any) => SQLite.Factory(module));
  describe(`${key} create_function`, function() {
    let db: any;
    beforeEach(async function() {
      db = await sqlite3.open_v2(':memory:');
    });

    afterEach(async function() {
      await sqlite3.close(db);
    });

    it('should return an int', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        0,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          sqlite3.result_int(context, 42);
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let result: unknown;
      rc = await sqlite3.exec(db, 'SELECT fn()', (row: unknown[]) => result = row[0]);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(result).to.equal(42);
    });

    it('should return an int64', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        0,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          sqlite3.result_int64(context, 0x7FFF_FFFF_FFFF_FFFFn);
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      for await (const stmt of sqlite3.statements(db, 'SELECT fn()')) {
        while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
          const value = sqlite3.column_int64(stmt, 0);
          expect(value).to.equal(0x7FFF_FFFF_FFFF_FFFFn);
        }
      }
    });

    it('should return a double', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        0,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          sqlite3.result_double(context, 3.14);
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let result: unknown;
      rc = await sqlite3.exec(db, 'SELECT fn()', (row: unknown[]) => result = row[0]);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(result).to.equal(3.14);
    });

    it('should return a string', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        0,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          sqlite3.result_text(context, 'foobar');
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let result: unknown;
      rc = await sqlite3.exec(db, 'SELECT fn()', (row: unknown[]) => result = row[0]);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(result).to.equal('foobar');
    });

    it('should return a blob', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        0,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          sqlite3.result_blob(context, new Uint8Array([0x12, 0x34, 0x56]));
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let result: unknown;
      rc = await sqlite3.exec(db, 'SELECT fn()', (row: unknown[]) => result = row[0]);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(result).to.deep.equal(new Uint8Array([0x12, 0x34, 0x56]));
    });

    it('should return null', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        0,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          sqlite3.result_null(context);
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let result: unknown;
      rc = await sqlite3.exec(db, 'SELECT fn()', (row: unknown[]) => result = row[0]);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(result).to.equal(null);
    });

    it('should pass a fixed number of arguments', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        5,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          expect(sqlite3.value_type(values[0])).to.equal(SQLite.SQLITE_INTEGER);
          expect(sqlite3.value_int(values[0])).to.equal(42);
          expect(sqlite3.value_int64(values[0])).to.equal(42n);
          expect(sqlite3.value(values[0])).to.equal(42);

          expect(sqlite3.value_type(values[1])).to.equal(SQLite.SQLITE_FLOAT);
          expect(sqlite3.value_double(values[1])).to.equal(3.14);
          expect(sqlite3.value(values[1])).to.equal(3.14);

          expect(sqlite3.value_type(values[2])).to.equal(SQLite.SQLITE_TEXT);
          expect(sqlite3.value_text(values[2])).to.equal('hello');
          expect(sqlite3.value(values[2])).to.equal('hello');

          expect(sqlite3.value_type(values[3])).to.equal(SQLite.SQLITE_BLOB);
          expect(sqlite3.value_blob(values[3])).to.deep.equal(new Uint8Array([0x12, 0x34, 0x56]));
          expect(sqlite3.value_bytes(values[3])).to.equal(3);
          expect(sqlite3.value(values[3])).to.deep.equal(new Uint8Array([0x12, 0x34, 0x56]));

          expect(sqlite3.value_type(values[4])).to.equal(SQLite.SQLITE_NULL);
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.exec(db, `
        SELECT fn(42, 3.14, 'hello', x'123456', NULL)
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
    });

    it('should pass a variable number of arguments', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        -1,
        SQLite.SQLITE_DETERMINISTIC, 0,
        (function(context: any, values: any) {
          expect(values.length).to.equal(5);

          expect(sqlite3.value_type(values[0])).to.equal(SQLite.SQLITE_INTEGER);
          expect(sqlite3.value_int(values[0])).to.equal(42);
          expect(sqlite3.value_int64(values[0])).to.equal(42n);
          expect(sqlite3.value_double(values[0])).to.equal(42.0);
          expect(sqlite3.value(values[0])).to.equal(42);

          expect(sqlite3.value_type(values[1])).to.equal(SQLite.SQLITE_FLOAT);
          expect(sqlite3.value_double(values[1])).to.equal(3.14);
          expect(sqlite3.value(values[1])).to.equal(3.14);

          expect(sqlite3.value_type(values[2])).to.equal(SQLite.SQLITE_TEXT);
          expect(sqlite3.value_text(values[2])).to.equal('hello');
          expect(sqlite3.value(values[2])).to.equal('hello');

          expect(sqlite3.value_type(values[3])).to.equal(SQLite.SQLITE_BLOB);
          expect(sqlite3.value_blob(values[3])).to.deep.equal(new Uint8Array([0x12, 0x34, 0x56]));
          expect(sqlite3.value_bytes(values[3])).to.equal(3);
          expect(sqlite3.value(values[3])).to.deep.equal(new Uint8Array([0x12, 0x34, 0x56]));

          expect(sqlite3.value_type(values[4])).to.equal(SQLite.SQLITE_NULL);
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.exec(db, `
        SELECT fn(42, 3.14, 'hello', x'123456', NULL)
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
    });

    it('should create an aggregate function', async function() {
      let rc: number;

      let product = 1;
      rc = await sqlite3.create_function(
        db,
        'fn',
        1,
        SQLite.SQLITE_DETERMINISTIC, 0,
        null,
        (function(context: any, values: any) {
          const value = sqlite3.value_double(values[0]);
          product *= value;
        }),
        (function(context: any) {
          sqlite3.result_double(context, product);
        }));
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.exec(db, `
        SELECT fn(column1) FROM (VALUES (1), (2), (3), (4), (5));
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(product).to.equal(1 * 2 * 3 * 4 * 5);
    });

    it('should return asynchronously', async function() {
      let rc: number;

      rc = await sqlite3.create_function(
        db,
        'fn',
        0,
        SQLite.SQLITE_DETERMINISTIC, 0,
        async (context: any, values: any) => {
          await new Promise(resolve => setTimeout(resolve));
          sqlite3.result_int(context, 42);
        });
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let result: unknown;
      rc = await sqlite3.exec(db, 'SELECT fn()', (row: unknown[]) => result = row[0]);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(result).to.equal(42);
    });
  });

  describe(`${key} progress_handler`, function() {
    let db: any;
    beforeEach(async function() {
      db = await sqlite3.open_v2(':memory:');
    });

    afterEach(async function() {
      await sqlite3.close(db);
    });

    it('should call progress handler', async function() {
      let rc: number;

      let count = 0;
      await sqlite3.progress_handler(db, 1, () => ++count && 0, null);

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
      expect(count).to.be.above(0);
    });

    it('should call asynchronous progress handler', async function() {
      let rc: number;

      let count = 0;
      await sqlite3.progress_handler(db, 1, async () => ++count && 0, null);

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
      expect(count).to.be.above(0);
    });
  });

  describe(`${key} set_authorizer`, function() {
    let db: any;
    beforeEach(async function() {
      db = await sqlite3.open_v2(':memory:');
    });

    afterEach(async function() {
      await sqlite3.close(db);
    });

    it('should call authorizer', async function() {
      let rc: number;

      const authorizations: unknown[][] = [];
      rc = sqlite3.set_authorizer(db, (_: any, iActionCode: any, p3: any, p4: any, p5: any, p6: any) => {
        authorizations.push([iActionCode, p3, p4, p5, p6]);
        return SQLite.SQLITE_OK;
      });
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.exec(db, 'CREATE TABLE t(x)');
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let authCreateTable = false;
      for (const authorization of authorizations) {
        switch (authorization[0]) {
          case SQLite.SQLITE_CREATE_TABLE:
            authCreateTable = true;
            expect(authorization[1]).to.equal('t');
            expect(authorization[2]).to.equal('');
            expect(authorization[3]).to.equal('main');
            expect(authorization[4]).to.equal('');
            break;
        }
      }
      expect(authCreateTable).to.be.true;
    });

    it('should deny authorization', async function() {
      let rc: number;

      rc = sqlite3.set_authorizer(db, (_: any, iActionCode: any, p3: any, p4: any, p5: any, p6: any) => {
        return SQLite.SQLITE_DENY;
      });
      expect(rc).to.equal(SQLite.SQLITE_OK);

      const result = sqlite3.exec(db, 'CREATE TABLE t(x)');
      await expectAsync(result).toBeRejectedWith(new Error('not authorized'));
    });

    it('should call async authorizer', async function() {
      let rc: number;

      const authorizations: unknown[][] = [];
      rc = sqlite3.set_authorizer(db, async (_: any, iActionCode: any, p3: any, p4: any, p5: any, p6: any) => {
        authorizations.push([iActionCode, p3, p4, p5, p6]);
        return SQLite.SQLITE_OK;
      });
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.exec(db, 'CREATE TABLE t(x)');
      expect(rc).to.equal(SQLite.SQLITE_OK);

      expect(authorizations.length).to.be.above(0);
    });
  });

  describe(`${key} update_hook`, function() {
    let db: any;
    beforeEach(async function() {
      db = await sqlite3.open_v2(':memory:');
    });

    afterEach(async function() {
      await sqlite3.close(db);
    });

    it('should call update hook', async function() {
      let rc: number;

      const calls: unknown[][] = [];
      sqlite3.update_hook(db, (updateType: any, dbName: any, tblName: any, rowid: any) => {
        calls.push([updateType, dbName, tblName, rowid]);
      });

      rc = await sqlite3.exec(db, `
        CREATE TABLE t(i integer primary key, x);
        INSERT INTO t VALUES (1, 'foo'), (2, 'bar'), (12345678987654321, 'baz');
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(calls).to.deep.equal([
        [18, 'main', 't', 1n],
        [18, 'main', 't', 2n],
        [18, 'main', 't', 12345678987654321n],
      ]);

      calls.splice(0, calls.length);

      await sqlite3.exec(db, `DELETE FROM t WHERE i = 2`);
      expect(calls).to.deep.equal([[9, 'main', 't', 2n]]);

      calls.splice(0, calls.length);

      await sqlite3.exec(db, `UPDATE t SET x = 'bar' WHERE i = 1`);
      expect(calls).to.deep.equal([[23, 'main', 't', 1n]]);
    });
  });

  describe(`${key} commit_hook`, function() {
    let db: any;
    beforeEach(async function() {
      db = await sqlite3.open_v2(':memory:');
    });

    afterEach(async function() {
      await sqlite3.close(db);
    });

    it('should call commit hook', async function() {
      let rc: number;

      let callsCount = 0;
      const resetCallsCount = () => callsCount = 0;

      sqlite3.commit_hook(db, () => {
        callsCount++;
        return 0;
      });
      expect(callsCount).to.equal(0);
      resetCallsCount();

      rc = await sqlite3.exec(db, `
        CREATE TABLE t(i integer primary key, x);
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(callsCount).to.equal(1);
      resetCallsCount();

      rc = await sqlite3.exec(db, `
        SELECT * FROM t;
      `);
      expect(callsCount).to.equal(0);
      resetCallsCount();

      rc = await sqlite3.exec(db, `
        BEGIN TRANSACTION;
        INSERT INTO t VALUES (1, 'foo');
        ROLLBACK;
      `);
      expect(callsCount).to.equal(0);
      resetCallsCount();

      rc = await sqlite3.exec(db, `
        BEGIN TRANSACTION;
        INSERT INTO t VALUES (1, 'foo');
        INSERT INTO t VALUES (2, 'bar');
        COMMIT;
      `);
      expect(callsCount).to.equal(1);
      resetCallsCount();
    });

    it('can change commit hook', async function() {
      let rc: number;
      rc = await sqlite3.exec(db, `
        CREATE TABLE t(i integer primary key, x);
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let a = 0;
      let b = 0;

      // set hook to increment `a` on commit
      sqlite3.commit_hook(db, () => {
        a++;
        return 0;
      });
      rc = await sqlite3.exec(db, `
        INSERT INTO t VALUES (1, 'foo');
      `);
      expect(a).to.equal(1);
      expect(b).to.equal(0);

      // switch to increment `b`
      sqlite3.commit_hook(db, () => {
        b++;
        return 0;
      });

      rc = await sqlite3.exec(db, `
        INSERT INTO t VALUES (2, 'bar');
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(a).to.equal(1);
      expect(b).to.equal(1);

      // disable hook by passing null
      sqlite3.commit_hook(db, null);

      rc = await sqlite3.exec(db, `
        INSERT INTO t VALUES (3, 'qux');
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(a).to.equal(1);
      expect(b).to.equal(1);
    });

    it('can rollback based on return value', async function() {
      let rc: number;
      rc = await sqlite3.exec(db, `
        CREATE TABLE t(i integer primary key, x);
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      // accept commit by returning 0
      sqlite3.commit_hook(db, () => 0);
      rc = await sqlite3.exec(db, `
        INSERT INTO t VALUES (1, 'foo');
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      // reject commit by returning 1, causing rollback
      sqlite3.commit_hook(db, () => 1);
      await expectAsync(
        sqlite3.exec(db, `INSERT INTO t VALUES (2, 'bar');`)
      ).toBeRejected();

      // double-check that the insert was rolled back
      let hasRow = false;
      rc = await sqlite3.exec(db, `
        SELECT * FROM t WHERE i = 2;
      `, () => hasRow = true);
      expect(rc).to.equal(SQLite.SQLITE_OK);
      expect(hasRow).to.be.false;
    });

    it('does not overwrite update_hook', async function() {
      let rc: number;
      rc = await sqlite3.exec(db, `
        CREATE TABLE t(i integer primary key, x);
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let updateHookInvocationsCount = 0;
      sqlite3.update_hook(db, (...args: unknown[]) => {
        updateHookInvocationsCount++;
      });

      let commitHookInvocationsCount = 0;
      sqlite3.commit_hook(db, () => {
        commitHookInvocationsCount++;
        return 0;
      });

      rc = await sqlite3.exec(db, `
        INSERT INTO t VALUES (1, 'foo');
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      expect(updateHookInvocationsCount).to.equal(1);
      expect(commitHookInvocationsCount).to.equal(1);
    });
  });
}
