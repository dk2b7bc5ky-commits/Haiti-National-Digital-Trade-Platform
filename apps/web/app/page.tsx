'use client';

import { useEffect, useState } from 'react';
import type { ApiResponse, HealthStatus } from '@rezo/shared-types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

type Probe =
  | { state: 'loading' }
  | { state: 'ok'; status: string }
  | { state: 'error'; message: string };

export default function HomePage() {
  const [probe, setProbe] = useState<Probe>({ state: 'loading' });

  async function check() {
    setProbe({ state: 'loading' });
    try {
      const res = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });
      const body = (await res.json()) as ApiResponse<HealthStatus>;
      if (body.error) {
        setProbe({ state: 'error', message: `${body.error.code}: ${body.error.message}` });
      } else {
        setProbe({ state: 'ok', status: body.data.status });
      }
    } catch (e) {
      setProbe({
        state: 'error',
        message: e instanceof Error ? e.message : 'Could not reach the API.',
      });
    }
  }

  useEffect(() => {
    void check();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <header>
        <p className="text-sm font-medium uppercase tracking-widest text-sky-600">Rezo · Haiti</p>
        <h1 className="mt-1 text-3xl font-bold">National Digital Trade Platform</h1>
        <p className="mt-2 text-slate-600">
          Step 1 scaffold — proving the frontend ↔ backend ↔ database round-trip.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-500">API health check</h2>
            <p className="mt-1 text-xs text-slate-400">
              GET {API_BASE_URL}/health
            </p>
          </div>
          <StatusBadge probe={probe} />
        </div>

        {probe.state === 'error' && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{probe.message}</p>
        )}

        <button
          onClick={() => void check()}
          className="mt-5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
        >
          Re-check
        </button>
      </section>

      <footer className="text-center text-xs text-slate-400">
        Rezo beta · MACCO LLC · orchestrator, not custodian
      </footer>
    </main>
  );
}

function StatusBadge({ probe }: { probe: Probe }) {
  if (probe.state === 'loading') {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-500">
        Checking…
      </span>
    );
  }
  if (probe.state === 'ok') {
    return (
      <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700">
        {probe.status}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
      unreachable
    </span>
  );
}
