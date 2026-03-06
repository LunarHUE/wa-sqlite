import * as SQLite from '../sqlite-api';

export function createTag(sqlite3: any, db: number) {
  async function execute(sql: string, bindings?: any[][]): Promise<any[]> {
    const results = [];
    for await (const stmt of sqlite3.statements(db, sql)) {
      let columns: string[];
      for (const binding of bindings ?? [[]]) {
        sqlite3.reset(stmt);
        if (bindings) {
          sqlite3.bind_collection(stmt, binding);
        }

        const rows = [];
        while (await sqlite3.step(stmt) === SQLite.SQLITE_ROW) {
          const row = sqlite3.row(stmt);
          rows.push(row);
        }

        columns = columns ?? sqlite3.column_names(stmt);
        if (columns.length) {
          results.push({ columns, rows });
        }
      }

      if (bindings) {
        return results;
      }
    }
    return results;
  }

  return async function(sql: string | TemplateStringsArray, ...values: any[]): Promise<any[]> {
    if (Array.isArray(sql)) {
      const interleaved: string[] = [];
      (sql as TemplateStringsArray).forEach((s, i) => {
        interleaved.push(s, values[i]);
      });
      return execute(interleaved.join(''));
    } else {
      return execute(sql as string, values[0]);
    }
  };
}
