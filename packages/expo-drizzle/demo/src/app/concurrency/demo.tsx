'use client';

import WaFactory from '@lunarhue/wa-sqlite-wasm/wa-sqlite-async.mjs';
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { useWaSQLiteDB } from '@lunarhue/expo-wa-sqlite';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { useState } from 'react';

// Inline schemas for the concurrency test tables
const concA = sqliteTable('conc_a', {
  id: int().primaryKey({ autoIncrement: true }),
  val: text().notNull(),
});
const concB = sqliteTable('conc_b', {
  id: int().primaryKey({ autoIncrement: true }),
  val: text().notNull(),
});

// ── Issue 1: Broken singleton ─────────────────────────────────────────────────
// Caches the resolved result instead of the in-flight promise.
// Two concurrent callers both see `instance === null` and both run init.
interface RaceResult {
  initCount: number;
  sameRef: boolean;
  aId: number;
  bId: number;
}

async function runSingletonRaceTest(): Promise<RaceResult> {
  let instance: { id: number } | null = null;
  let initCount = 0;

  async function brokenGetDb(): Promise<{ id: number }> {
    if (instance) return instance;
    initCount++;
    // Simulate async work: WASM compilation, IDB open, VFS registration, etc.
    await new Promise<void>((r) => setTimeout(r, 20));
    // Each caller creates its own object (like opening a new IDB connection).
    instance = { id: initCount };
    return instance;
  }

  const [a, b] = await Promise.all([brokenGetDb(), brokenGetDb()]);
  return { initCount, sameRef: a === b, aId: a.id, bId: b.id };
}

// ── Issue 2: Concurrent WASM statement execution ──────────────────────────────
// Two SELECT queries run via Promise.all on the same db handle.
// Their `await sqlite3.step(stmt)` calls can interleave, corrupting results.
interface ConcurrentResult {
  log: string[];
  passed: number;
  total: number;
}

async function runConcurrentQueryTest(
  db: SqliteRemoteDatabase<Record<string, never>>,
): Promise<ConcurrentResult> {
  // Create tables and seed data (idempotent)
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS conc_a (id INTEGER PRIMARY KEY AUTOINCREMENT, val TEXT NOT NULL)
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS conc_b (id INTEGER PRIMARY KEY AUTOINCREMENT, val TEXT NOT NULL)
  `);
  const existingA = await db.select().from(concA);
  if (existingA.length === 0) {
    for (let i = 1; i <= 5; i++) {
      await db.insert(concA).values({ val: `alpha-${i}` });
      await db.insert(concB).values({ val: `beta-${i}` });
    }
  }

  const log: string[] = [];
  let passed = 0;
  const total = 30;

  for (let i = 0; i < total; i++) {
    try {
      // Two queries on the same connection, interleaving at every `await step()`
      const [ra, rb] = await Promise.all([
        db.select().from(concA),
        db.select().from(concB),
      ]);

      const aOk = ra.length === 5;
      const bOk = rb.length === 5;

      if (aOk && bOk) {
        passed++;
      } else {
        log.push(
          `[iter ${i}] Wrong row counts — conc_a: ${ra.length} (expected 5), conc_b: ${rb.length} (expected 5)`,
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.push(`[iter ${i}] Error: ${msg}`);
    }
  }

  if (passed === total) {
    log.push(`All ${total} concurrent query pairs passed — no visible interleaving.`);
  } else {
    log.unshift(`${passed}/${total} passed · ${total - passed} failed.`);
  }

  return { log, passed, total };
}

// ── Component ─────────────────────────────────────────────────────────────────

const pre: React.CSSProperties = {
  background: '#f5f5f5',
  padding: 12,
  marginTop: 8,
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const badge = (ok: boolean): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 700,
  background: ok ? '#d4edda' : '#f8d7da',
  color: ok ? '#155724' : '#721c24',
  marginLeft: 8,
});

export default function ConcurrencyDemo() {
  const { db, isReady, error } = useWaSQLiteDB({
    dbName: 'concurrency-demo',
    moduleFactory: WaFactory,
    wasmUrl: '/wa-sqlite-async.wasm',
  });

  const [raceResult, setRaceResult] = useState<RaceResult | null>(null);
  const [raceRunning, setRaceRunning] = useState(false);
  const [concResult, setConcResult] = useState<ConcurrentResult | null>(null);
  const [concRunning, setConcRunning] = useState(false);

  if (error) return <p style={{ color: 'red' }}>DB error: {error.message}</p>;
  if (!isReady) return <p>Opening database…</p>;

  const runRace = async () => {
    setRaceRunning(true);
    setRaceResult(null);
    try {
      setRaceResult(await runSingletonRaceTest());
    } finally {
      setRaceRunning(false);
    }
  };

  const runConc = async () => {
    if (!db) return;
    setConcRunning(true);
    setConcResult(null);
    try {
      setConcResult(await runConcurrentQueryTest(db));
    } finally {
      setConcRunning(false);
    }
  };

  return (
    <div>
      {/* ── Issue 1 ── */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ marginBottom: 4 }}>Issue 1 — Singleton Init Race</h2>
        <p style={{ color: '#555', fontSize: 14, marginTop: 0 }}>
          A broken <code>getDb()</code> caches the <em>resolved value</em> instead of the
          in-flight promise. Two concurrent callers both see <code>instance === null</code> and
          both enter the async init body — opening two separate WASM/IDB connections against the
          same store. The last one to finish overwrites the singleton; the first connection is
          orphaned.
        </p>
        <p style={{ color: '#555', fontSize: 14 }}>
          <strong>Fix:</strong> cache the promise itself:{' '}
          <code>if (!_promise) _promise = initDb(); return _promise;</code>
        </p>
        <button onClick={runRace} disabled={raceRunning} style={{ padding: '6px 16px' }}>
          {raceRunning ? 'Running…' : 'Run singleton race test'}
        </button>

        {raceResult && (
          <pre style={pre}>
            {`initCount : ${raceResult.initCount}  ${raceResult.initCount > 1 ? '← init ran TWICE (bug)' : '← init ran once (ok)'}\n`}
            {`a.id      : ${raceResult.aId}\n`}
            {`b.id      : ${raceResult.bId}\n`}
            {`a === b   : ${raceResult.sameRef}`}
            {'\n\n'}
            {raceResult.initCount > 1
              ? '✗  Both callers entered init. Two connections were opened.\n   The first is now orphaned (its IDB locks are held but unreachable).'
              : '✓  Init ran once — singleton is safe.'}
          </pre>
        )}
      </section>

      {/* ── Issue 2 ── */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ marginBottom: 4 }}>Issue 2 — Concurrent WASM Statement Execution</h2>
        <p style={{ color: '#555', fontSize: 14, marginTop: 0 }}>
          Two <code>SELECT</code> queries are dispatched simultaneously via{' '}
          <code>Promise.all</code> on the same SQLite connection. The executor loops over{' '}
          <code>await sqlite3.step(stmt)</code> — each <code>await</code> yields control.
          Interleaved steps across statements on the same connection can corrupt result rows or
          throw errors.
        </p>
        <p style={{ color: '#555', fontSize: 14 }}>
          <strong>Fix:</strong> wrap the executor with a mutex/async queue so only one statement
          runs at a time per connection.
        </p>
        <button onClick={runConc} disabled={concRunning} style={{ padding: '6px 16px' }}>
          {concRunning ? 'Running…' : 'Run 30 concurrent query pairs'}
        </button>

        {concResult && (
          <>
            <div style={{ marginTop: 8 }}>
              <strong>
                {concResult.passed}/{concResult.total} passed
              </strong>
              <span style={badge(concResult.passed === concResult.total)}>
                {concResult.passed === concResult.total ? 'PASS' : 'FAIL'}
              </span>
            </div>
            {concResult.log.length > 0 && (
              <pre style={pre}>{concResult.log.join('\n')}</pre>
            )}
          </>
        )}
      </section>
    </div>
  );
}
