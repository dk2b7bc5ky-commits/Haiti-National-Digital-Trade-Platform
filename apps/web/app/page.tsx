'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

/** Entry point: route to the dashboard if authenticated, else to login. */
export default function HomePage() {
  const { loading, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(token ? '/dashboard' : '/login');
  }, [loading, token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-500">Loading Rezo…</p>
    </main>
  );
}
