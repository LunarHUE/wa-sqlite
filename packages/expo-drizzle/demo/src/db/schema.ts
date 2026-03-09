import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const todos = sqliteTable('todos', {
  id: int().primaryKey({ autoIncrement: true }),
  text: text().notNull(),
  done: int({ mode: 'boolean' }).notNull().default(false),
});
