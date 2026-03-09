'use client';

// This component is loaded via next/dynamic with ssr: false, so it only ever
// runs in the browser. It is safe to import the Emscripten WASM factory here.
import WaFactory from '@lunarhue/wa-sqlite-wasm/wa-sqlite-async.mjs';
import { eq, sql } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWaSQLiteDB } from '@lunarhue/expo-wa-sqlite';
import { todos } from '@/db/schema';

type Todo = typeof todos.$inferSelect;

export default function Todos() {
  const { db, isReady, error } = useWaSQLiteDB({
    dbName: 'todos-demo',
    moduleFactory: WaFactory,
    // The WASM binary is copied to /public by the dev/build script.
    wasmUrl: '/wa-sqlite-async.wasm',
  });

  const [items, setItems] = useState<Todo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!db) return;
    setItems(await db.select().from(todos).orderBy(todos.id));
  }, [db]);

  useEffect(() => {
    if (!isReady || !db) return;
    // Create the table if this is a fresh database, then load rows.
    db.run(sql`
      CREATE TABLE IF NOT EXISTS todos (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT    NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      )
    `).then(() => refresh());
  }, [isReady, db, refresh]);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text || !db) return;
    await db.insert(todos).values({ text, done: false });
    inputRef.current!.value = '';
    refresh();
  };

  const toggleTodo = async (todo: Todo) => {
    if (!db) return;
    await db.update(todos).set({ done: !todo.done }).where(eq(todos.id, todo.id));
    refresh();
  };

  const deleteTodo = async (id: number) => {
    if (!db) return;
    await db.delete(todos).where(eq(todos.id, id));
    refresh();
  };

  if (error) {
    return <p style={{ color: 'red' }}>Error: {error.message}</p>;
  }

  if (!isReady) {
    return <p>Opening database…</p>;
  }

  return (
    <div>
      <form onSubmit={addTodo} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          ref={inputRef}
          placeholder="What needs doing?"
          style={{ flex: 1, padding: '6px 10px', fontSize: 16 }}
        />
        <button type="submit" style={{ padding: '6px 16px' }}>Add</button>
      </form>

      {items.length === 0 && <p style={{ color: '#888' }}>No todos yet.</p>}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((todo) => (
          <li
            key={todo.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
          >
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggleTodo(todo)}
            />
            <span style={{
              flex: 1,
              textDecoration: todo.done ? 'line-through' : 'none',
              color: todo.done ? '#aaa' : 'inherit',
            }}>
              {todo.text}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <p style={{ marginTop: 24, fontSize: 12, color: '#aaa' }}>
        Storage: IndexedDB · VFS: IDBBatchAtomicVFS · ORM: drizzle-orm
      </p>
    </div>
  );
}
