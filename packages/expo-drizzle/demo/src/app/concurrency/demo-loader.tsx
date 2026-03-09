'use client';

import dynamic from 'next/dynamic';

const ConcurrencyDemo = dynamic(() => import('./demo'), {
  ssr: false,
  loading: () => <p>Initialising database…</p>,
});

export default function ConcurrencyDemoLoader() {
  return <ConcurrencyDemo />;
}
