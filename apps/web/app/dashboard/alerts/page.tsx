'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AlertSummary } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetchEnvelope, apiFetch } from '../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};
const CHANNEL_ICON: Record<string, string> = { in_app: '🔔', email: '✉️', sms: '💬' };

export default function AlertsPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [rows, setRows] = useState<AlertSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<AlertSummary[]>('/alerts?limit=200', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setRows(json.data ?? [])))
      .catch(() => setErr('Could not load alerts.'));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function markRead(id: string) {
    await apiFetch(`/alerts/${id}/read`, { method: 'POST', token }).catch(() => {});
    load();
  }

  if (!ready || !auth) return <Loading />;

  const sent = rows?.filter((a) => a.status === 'sent') ?? [];
  const upcoming = rows?.filter((a) => a.status !== 'sent') ?? [];

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">Alerts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Deadline reminders fire automatically at configured intervals (in-app + email). A missed alert is a real financial loss, so delivery is persisted and retried.
      </p>
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      <Section title={`Delivered (${sent.length})`} empty="No alerts delivered yet.">
        {sent.map((a) => <AlertRow key={a.id} a={a} onRead={markRead} />)}
      </Section>

      <Section title={`Scheduled (${upcoming.length})`} empty="Nothing scheduled.">
        {upcoming.map((a) => <AlertRow key={a.id} a={a} onRead={markRead} />)}
      </Section>
    </Chrome>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {items.length === 0 ? <p className="p-5 text-sm text-slate-500">{empty}</p> : children}
      </div>
    </section>
  );
}

function AlertRow({ a, onRead }: { a: AlertSummary; onRead: (id: string) => void }) {
  const unread = a.status === 'sent' && !a.read_at && a.channel === 'in_app';
  return (
    <div className={`flex items-start gap-3 p-4 ${unread ? 'bg-sky-50/50' : ''}`}>
      <span className="text-lg" title={a.channel}>{CHANNEL_ICON[a.channel] ?? '•'}</span>
      <div className="flex-1">
        <p className="text-sm text-slate-800">{a.message}</p>
        <p className="mt-1 text-xs text-slate-400">
          <Link href={`/dashboard/containers/${a.container_id}`} className="font-mono text-sky-700 hover:underline">{a.container_number}</Link>
          {' · '}{a.channel}{' · '}scheduled {new Date(a.scheduled_for).toLocaleDateString()}
          {a.sent_at ? ` · sent ${new Date(a.sent_at).toLocaleString()}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[a.status] ?? ''}`}>{a.status}</span>
        {unread && (
          <button onClick={() => onRead(a.id)} className="text-xs text-sky-700 hover:underline">mark read</button>
        )}
      </div>
    </div>
  );
}
