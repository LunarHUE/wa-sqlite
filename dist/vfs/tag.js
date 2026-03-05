import * as SQLite from '../sqlite-api';
export function createTag(sqlite3, db) {
    async function execute(sql, bindings) {
        const results = [];
        for await (const stmt of sqlite3.statements(db, sql)) {
            let columns;
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
    return async function (sql, ...values) {
        if (Array.isArray(sql)) {
            const interleaved = [];
            sql.forEach((s, i) => {
                interleaved.push(s, values[i]);
            });
            return execute(interleaved.join(''));
        }
        else {
            return execute(sql, values[0]);
        }
    };
}
