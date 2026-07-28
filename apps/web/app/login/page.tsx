'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { ApiClientError } from '../../lib/api';

const DEMO_ACCOUNTS = [
  ['admin@rezo.test', 'Rezo Admin'],
  ['ops@rezo.test', 'Rezo Ops'],
  ['line@rezo.test', 'Shipping Line'],
  ['importer@rezo.test', 'Importer'],
  ['broker@rezo.test', 'Broker'],
  ['trucker@rezo.test', 'Trucker'],
  ['terminal@rezo.test', 'Terminal'],
  ['customs@rezo.test', 'Customs'],
  ['bank@rezo.test', 'Bank'],
  ['gov@rezo.test', 'Government'],
] as const;

export default function LoginPage() {
  const { login, token, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('admin@rezo.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && token) router.replace('/dashboard');
  }, [loading, token, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <p className="text-sm font-medium uppercase tracking-widest text-sky-600">Rezo · Haiti</p>
          <h1 className="mt-1 text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">National Digital Trade Platform</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              required
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Demo accounts</p>
          <p className="mb-2 mt-1 text-xs text-slate-400">password: <code className="rounded bg-slate-100 px-1">password123</code></p>
          <div className="grid grid-cols-2 gap-1">
            {DEMO_ACCOUNTS.map(([addr, label]) => (
              <button
                key={addr}
                onClick={() => { setEmail(addr); setPassword('password123'); }}
                className="rounded-md px-2 py-1 text-left text-xs text-slate-600 hover:bg-slate-100"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-slate-400">
          <Link href="/vision" className="hover:text-sky-700 hover:underline">See Haiti’s national trade vision →</Link>
        </p>
      </div>
    </main>
  );
}
