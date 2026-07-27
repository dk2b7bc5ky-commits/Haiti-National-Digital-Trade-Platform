'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary, OperationalDashboard, NotificationSummary, Money as MoneyT } from '@rezo/shared-types';
import { useAuth } from '../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../lib/api';
import { countdown } from '../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../components/chrome';
import { Money, MoneyList, StatusPill, type PillTone } from '../../components/ui';

const COUNTDOWN_TONE: Record<string, PillTone> = { ok: 'gray', soon: 'amber', overdue: 'red' };
const ACT_ICON: Record<string, string> = {
  payment_confirmed: '✅', payment_failed: '❌', container_released: '📦', gate_appointment_confirmed: '🚪',
  gate_reminder: '🚪', verification_needed: '🔍', charge_added: '🧾', document_required: '📄',
  deadline_reminder: '⏰', trucking_job_offered: '🚚', trucking_job_accepted: '🚚', trucking_job_delivered: '🚚',
};

function sumByCurrency(items: (MoneyT | null | undefined)[]): MoneyT[] {
  const m = new Map<string, number>();
  for (const it of items) if (it) m.set(it.currency, (m.get(it.currency) ?? 0) + it.amount);
  return [...m.entries()].map(([currency, amount]) => ({ amount, currency }));
}

export default function DashboardPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [op, setOp] = useState<OperationalDashboard | null>(null);
  const [activity, setActivity] = useState<NotificationSummary[]>([]);

  useEffect(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerSummary[]>('/containers?limit=200', { token }).then(({ json }) => setContainers(json.data ?? [])).catch(() => {});
    apiFetch<OperationalDashboard>('/dashboard/operational', { token }).then(setOp).catch(() => {});
    apiFetch<NotificationSummary[]>('/notifications?limit=6', { token }).then(setActivity).catch(() => {});
  }, [token]);

  const owing = useMemo(() => containers.filter((c) => c.payment_status === 'pending' || c.payment_status === 'overdue'), [containers]);
  const totalOwed = useMemo(() => sumByCurrency(owing.map((c) => c.total_owed)), [owing]);
  const atRisk = useMemo(
    () => owing.filter((c) => { const cd = countdown(c.last_free_day); return cd && cd.days <= 2; }),
    [owing],
  );
  const attention = useMemo(() => {
    return [...owing]
      .map((c) => ({ c, cd: countdown(c.last_free_day) }))
      .sort((a, b) => (a.cd?.days ?? 9999) - (b.cd?.days ?? 9999))
      .slice(0, 6);
  }, [owing]);

  if (!ready || !auth) return <Loading />;

  const firstName = auth.user.name.split(' ')[0];

  return (
    <Chrome auth={auth}>
      <p className="text-sm text-slate-500">
        Bonjou, <span className="font-medium text-slate-700">{firstName}</span> · {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      <h1 className="mt-1 text-2xl font-bold">Overview</h1>

      {/* Owed strip — sums of real charges, never a held balance */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total owed" value={<MoneyList items={totalOwed} empty="$0.00" className="text-2xl font-bold text-slate-900" />} sub="across your active containers" />
        <Stat
          label="At risk (≤48h)"
          value={<span className={`text-2xl font-bold ${atRisk.length ? 'text-red-600' : 'text-slate-900'}`}>{atRisk.length}</span>}
          sub="last free day within 48h"
          tone={atRisk.length ? 'warn' : undefined}
        />
        {op && (
          <Stat label="Payments processed" value={<span className="text-2xl font-bold text-slate-900">{op.payments_processed}</span>} sub={<MoneyList items={op.amount_processed} empty="$0.00" />} />
        )}
        {op && (
          <Stat label="Released" value={<span className="text-2xl font-bold text-slate-900">{op.released}</span>} sub={`${op.gated_out} gated out`} />
        )}
      </section>

      {/* Needs your attention — the hero */}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Needs your attention</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
          {attention.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">🎉 Nothing needs your attention — every container is settled.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {attention.map(({ c, cd }) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-sky-50/40">
                  <div className="min-w-0">
                    <Link href={`/dashboard/containers/${c.id}`} className="font-mono font-medium text-sky-700 hover:underline">{c.container_number}</Link>
                    <span className="ml-2 text-xs text-slate-400">{c.voyage.port}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {c.total_owed && <Money amount={c.total_owed.amount} currency={c.total_owed.currency} className="text-sm font-semibold text-slate-800" />}
                    {cd && <StatusPill tone={COUNTDOWN_TONE[cd.tone]} label={cd.label} />}
                    <Link href={`/dashboard/containers/${c.id}`} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">Pay</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent activity */}
      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent activity</h2>
          <Link href="/dashboard/alerts" className="text-xs font-medium text-sky-700 hover:underline">See all →</Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-soft">
          {activity.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">No recent activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {activity.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5">{ACT_ICON[n.type] ?? '•'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800">
                      {n.title}
                      {n.container_number && <Link href={n.deep_link || `/dashboard/containers/${n.container_id}`} className="ml-2 font-mono text-xs text-sky-700 hover:underline">{n.container_number}</Link>}
                    </p>
                    <p className="text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </Chrome>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={`rounded-xl border p-5 shadow-soft ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1">{value}</div>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
