'use client';

import dynamic from 'next/dynamic';

// next/dynamic with ssr: false must live in a Client Component.
// This wrapper is the only thing page.tsx (a Server Component) needs to import.
const Todos = dynamic(() => import('./todos'), {
  ssr: false,
  loading: () => <p>Initialising database…</p>,
});

export default function TodosLoader() {
  return <Todos />;
}
