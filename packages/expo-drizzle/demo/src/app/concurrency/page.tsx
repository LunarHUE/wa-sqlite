import Link from 'next/link';
import ConcurrencyDemoLoader from './demo-loader';

export default function ConcurrencyPage() {
  return (
    <>
      <p style={{ marginBottom: 24 }}>
        <Link href="/">← back to todos demo</Link>
      </p>
      <h1>Async / Concurrency Issues</h1>
      <p style={{ color: '#555' }}>
        Reproduction tests for two classes of bugs that appear when wa-sqlite is used without
        proper guards: a singleton init race and interleaved WASM statement execution.
      </p>
      <ConcurrencyDemoLoader />
    </>
  );
}
