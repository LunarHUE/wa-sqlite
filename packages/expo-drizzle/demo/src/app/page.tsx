import Link from 'next/link';
import TodosLoader from './todos-loader';

export default function Page() {
  return (
    <>
      <h1>wa-sqlite + Drizzle</h1>
      <p style={{ color: '#555' }}>
        Persisted in IndexedDB via <code>IDBBatchAtomicVFS</code>. Reload the page — your todos survive.
      </p>
      <p style={{ fontSize: 14 }}>
        <Link href="/concurrency">→ Async / concurrency issue reproductions</Link>
      </p>
      <TodosLoader />
    </>
  );
}
