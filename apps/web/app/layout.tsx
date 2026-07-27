import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth';

export const metadata: Metadata = {
  title: 'Rezo — National Digital Trade Platform',
  description: 'Rezo — Haiti.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
