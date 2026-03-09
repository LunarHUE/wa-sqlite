import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'wa-sqlite + Drizzle Demo',
  description: 'IDBBatchAtomicVFS + drizzle-orm in the browser',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '3rem auto', padding: '0 1rem' }}>
        {children}
      </body>
    </html>
  );
}
