import * as SQLite from '../src/sqlite-api.js';
import { expect } from './helpers.ts';
import { TestContext } from './TestContext.ts';

export function api_statements(context: TestContext) {
  describe('statements', function() {
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

    it('should iterate', async function() {
      const sql = [
        'PRAGMA journal_mode',
        'CREATE TABLE t(x)',
        'SELECT * FROM sqlite_master'
      ];

      let count = 0;
      for await (const stmt of i(sqlite3.statements(db, sql.join(';\n')))) {
        // We should be able to retrieve each parsed statement.
        const query = await sqlite3.sql(stmt);
        expect(query.includes(sql[count++])).to.be.true;
      }
      expect(count).to.equal(sql.length);
    });

    it('should bind blob', async function() {
      let rc: number;
      const sql = 'SELECT ?';
      const value = new Uint8Array([1, 2, 3, 4, 5]);

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        rc = await sqlite3.bind_blob(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_BLOB);

          const blobTyped = await sqlite3.column_blob(stmt, 0);
          expect([...blobTyped]).to.deep.equal([...value]);

          const blobVariant = await sqlite3.column(stmt, 0);
          expect([...blobVariant]).to.deep.equal([...value]);
        }
      }

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        // Comlink intercepts the 'bind' property so use an alias.
        rc = await sqlite3.bind$(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_BLOB);

          const blob = await sqlite3.column_blob(stmt, 0);
          expect([...blob]).to.deep.equal([...value]);
        }
      }
    });

    it('should bind double', async function() {
      let rc: number;
      const sql = 'SELECT ?';
      const value = Math.PI;

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        rc = await sqlite3.bind_double(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_FLOAT);
          expect(await sqlite3.column_double(stmt, 0)).to.equal(value);
          expect(await sqlite3.column(stmt, 0)).to.equal(value);
        }
      }

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        // Comlink intercepts the 'bind' property so use an alias.
        rc = await sqlite3.bind$(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_FLOAT);
          expect(await sqlite3.column_double(stmt, 0)).to.equal(value);
        }
      }
    });

    it('should bind int', async function() {
      let rc: number;
      const sql = 'SELECT ?';
      const value = 42;

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        rc = await sqlite3.bind_int(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_INTEGER);
          expect(await sqlite3.column_int(stmt, 0)).to.equal(value);
          expect(await sqlite3.column(stmt, 0)).to.equal(value);
        }
      }

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        // Comlink intercepts the 'bind' property so use an alias.
        rc = await sqlite3.bind$(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_INTEGER);
          expect(await sqlite3.column_int(stmt, 0)).to.equal(value);
        }
      }
    });

    it('should bind int64', async function() {
      let rc: number;
      const sql = 'SELECT ?';
      const value = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        rc = await sqlite3.bind_int64(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_INTEGER);
          expect(await sqlite3.column_int64(stmt, 0)).to.equal(value);
          expect(await sqlite3.column(stmt, 0)).to.equal(value);
        }
      }

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        // Comlink intercepts the 'bind' property so use an alias.
        rc = await sqlite3.bind$(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_INTEGER);
          expect(await sqlite3.column_int64(stmt, 0)).to.equal(value);
        }
      }
    });

    it('should bind null', async function() {
      let rc: number;
      const sql = 'SELECT ?';

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        rc = await sqlite3.bind_null(stmt, 1);
        expect(rc).to.equal(SQLite.SQLITE_OK);
        expect(await sqlite3.bind_parameter_count(stmt)).to.equal(1);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_NULL);
          expect(await sqlite3.column(stmt, 0)).to.equal(null);
        }
      }

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        // Comlink intercepts the 'bind' property so use an alias.
        rc = await sqlite3.bind$(stmt, 1, null);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_NULL);
        }
      }
    });

    it('should bind text', async function() {
      let rc: number;
      const sql = 'SELECT ?';
      const value = 'Hello, world!';

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        rc = await sqlite3.bind_text(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_TEXT);
          expect(await sqlite3.column_text(stmt, 0)).to.equal(value);
          expect(await sqlite3.column(stmt, 0)).to.equal(value);
        }
      }

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        // Comlink intercepts the 'bind' property so use an alias.
        rc = await sqlite3.bind$(stmt, 1, value);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_TEXT);
          expect(await sqlite3.column_text(stmt, 0)).to.equal(value);
        }
      }
    });

    it('should bind boolean', async function() {
      let rc: number;
      const sql = 'SELECT ?';
      const storeValue = true;
      const expectedRetrievedValue = 1;

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        // Comlink intercepts the 'bind' property so use an alias.
        rc = await sqlite3.bind$(stmt, 1, storeValue);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(1);
          expect(await sqlite3.column_type(stmt, 0)).to.equal(SQLite.SQLITE_INTEGER);
          expect(await sqlite3.column_int(stmt, 0)).to.equal(expectedRetrievedValue);
        }
      }
    });

    it('should bind collection array', async function() {
      let rc: number;
      const sql = 'VALUES (?, ?, ?, ?, ?)';
      const cBlob = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
      const cDouble = Math.PI;
      const cInt = 42;
      const cNull = null;
      const cText = 'foobar';

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        expect(await sqlite3.column_name(stmt, 0)).to.equal('column1');
        expect(await sqlite3.column_name(stmt, 1)).to.equal('column2');
        expect(await sqlite3.column_name(stmt, 2)).to.equal('column3');
        expect(await sqlite3.column_name(stmt, 3)).to.equal('column4');
        expect(await sqlite3.column_name(stmt, 4)).to.equal('column5');

        expect(await sqlite3.column_names(stmt))
          .to.deep.equal(['column1', 'column2', 'column3', 'column4', 'column5']);

        rc = await sqlite3.bind_collection(stmt, [
          cBlob,
          cDouble,
          cInt,
          cNull,
          cText,
        ]);
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);
          expect(await sqlite3.data_count(stmt)).to.equal(5);
          expect(await sqlite3.column_count(stmt)).to.equal(5);

          const row = await sqlite3.row(stmt);
          expect(row.length).to.equal(5);

          expect(row[0] instanceof Uint8Array).to.be.true;
          expect([...row[0]]).to.deep.equal([...cBlob]);
          expect(row[1]).to.equal(cDouble);
          expect(row[2]).to.equal(cInt);
          expect(row[3]).to.equal(cNull);
          expect(row[4]).to.equal(cText);
        }
      }
    });

    it('should bind collection object', async function() {
      let rc: number;
      const sql = 'VALUES (:cBlob, :cDouble, :cInt, :cNull, :cText)';
      const cBlob = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
      const cDouble = Math.PI;
      const cInt = 42;
      const cNull = null;
      const cText = 'foobar';

      for await (const stmt of i(sqlite3.statements(db, sql))) {
        expect(await sqlite3.bind_parameter_count(stmt)).to.equal(5);
        expect(await sqlite3.bind_parameter_name(stmt, 1)).to.equal(':cBlob');
        expect(await sqlite3.bind_parameter_name(stmt, 2)).to.equal(':cDouble');
        expect(await sqlite3.bind_parameter_name(stmt, 3)).to.equal(':cInt');
        expect(await sqlite3.bind_parameter_name(stmt, 4)).to.equal(':cNull');
        expect(await sqlite3.bind_parameter_name(stmt, 5)).to.equal(':cText');

        rc = await sqlite3.bind_collection(stmt, {
          ':cBlob': cBlob,
          ':cDouble': cDouble,
          ':cInt': cInt,
          ':cNull': cNull,
          ':cText': cText
        });
        expect(rc).to.equal(SQLite.SQLITE_OK);

        while ((rc = await sqlite3.step(stmt)) !== SQLite.SQLITE_DONE) {
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          expect(await sqlite3.column_count(stmt)).to.equal(5);
          const row = await sqlite3.row(stmt);
          expect(row.length).to.equal(5);

          expect(row[0] instanceof Uint8Array).to.be.true;
          expect([...row[0]]).to.deep.equal([...cBlob]);
          expect(row[1]).to.equal(cDouble);
          expect(row[2]).to.equal(cInt);
          expect(row[3]).to.equal(cNull);
          expect(row[4]).to.equal(cText);
        }
      }
    });

    it('should allow unscoped lifetime', async function() {
      let rc: number;

      rc = await sqlite3.exec(db, `
        CREATE TABLE t AS VALUES ('foo', 0), ('bar', 1), ('baz', 2);
      `);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      let stmt: any;
      const sql = 'SELECT column2 FROM t WHERE column1 = ?';
      for await (const s of i(sqlite3.statements(db, sql, { unscoped: true }))) {
        if (s) {
          stmt = s;
        }
      }
      expect(stmt).to.be.above(0);

      // The statement should be active beyond the iterator lifecycle.
      rc = await sqlite3.bind_text(stmt, 1, 'foo');
      expect(rc).to.equal(SQLite.SQLITE_OK);
      rc = await sqlite3.step(stmt);
      expect(rc).to.equal(SQLite.SQLITE_ROW);
      expect(await sqlite3.column_int(stmt, 0)).to.equal(0);

      rc = await sqlite3.reset(stmt);
      expect(rc).to.equal(SQLite.SQLITE_OK);

      rc = await sqlite3.bind_text(stmt, 1, 'bar');
      expect(rc).to.equal(SQLite.SQLITE_OK);
      rc = await sqlite3.step(stmt);
      expect(rc).to.equal(SQLite.SQLITE_ROW);
      expect(await sqlite3.column_int(stmt, 0)).to.equal(1);

      rc = await sqlite3.step(stmt);
      expect(rc).to.equal(SQLite.SQLITE_DONE);

      rc = await sqlite3.finalize(stmt);
      expect(rc).to.equal(SQLite.SQLITE_OK);
    });

    it('should clear bindings', async function() {
      let rc: number;

      const sql = 'SELECT ?';
      for await (const stmt of i(sqlite3.statements(db, sql))) {
        {
          rc = await sqlite3.bind_int(stmt, 1, 42);
          expect(rc).to.equal(SQLite.SQLITE_OK);

          rc = await sqlite3.reset(stmt);
          expect(rc).to.equal(SQLite.SQLITE_OK);

          rc = await sqlite3.step(stmt);
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          const value = await sqlite3.column(stmt, 0);
          expect(value).to.equal(42);
        }

        {
          rc = await sqlite3.clear_bindings(stmt);
          expect(rc).to.equal(SQLite.SQLITE_OK);

          rc = await sqlite3.reset(stmt);
          expect(rc).to.equal(SQLite.SQLITE_OK);

          rc = await sqlite3.step(stmt);
          expect(rc).to.equal(SQLite.SQLITE_ROW);

          const value = await sqlite3.column(stmt, 0);
          expect(value).to.not.equal(42);
        }
      }
    });
  });
}

// sqlite3.statements() returns an async iterator, but its Comlink
// proxy needs this wrapper to be used.
async function* i(p: any) {
  const x = await p;
  try {
    let value: any, done: boolean;
    while (true) {
      ({ value, done } = await x.next());
      if (!done) {
        yield value;
      } else {
        break;
      }
    }
  } catch (e) {
    await x.throw(e);
  } finally {
    await x.return();
  }
}
