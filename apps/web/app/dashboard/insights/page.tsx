'use client';

import { useEffect, useState } from 'react';
import type { OperationalDashboard, GovernmentDashboard } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { formatMoneyList } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { Money, CountPill } from '../../../components/ui';

export default function InsightsPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const t = useT();
  const [op, setOp] = useState<OperationalDashboard | null>(null);
  const [gov, setGov] = useState<GovernmentDashboard | null>(null);
  const isGov = auth?.permissions.includes('dashboard:gov');

  useEffect(() => {
    if (!token) return;
    apiFetch<OperationalDashboard>('/dashboard/operational', { token }).then(setOp).catch(() => {});
    if (isGov) apiFetch<GovernmentDashboard>('/dashboard/government', { token }).then(setGov).catch(() => {});
  }, [token, isGov]);

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">{t('nav.dashboard')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('insights.subtitle')}{isGov ? t('insights.govSuffix') : ''}.</p>

      {op && (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('insights.containers')} value={String(op.containers_total)} />
            <Stat label={t('home.released')} value={String(op.released)} sub={t('home.gatedOut', { n: op.gated_out })} />
            <Stat label={t('insights.avgClearance')} value={op.avg_clearance_days != null ? `${op.avg_clearance_days} d` : '—'} />
            <Stat label={t('home.paymentsProcessed')} value={String(op.payments_processed)} sub={formatMoneyList(op.amount_processed)} />
          </section>

          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('insights.deadlinesAtRisk')} value={String(op.deadlines_at_risk)} tone={op.deadlines_at_risk > 0 ? 'warn' : undefined} />
            <div className="sm:col-span-2 lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">{t('insights.byStatus')}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {Object.entries(op.by_status).map(([k, v]) => (
                  <span key={k} className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">{k.replace(/_/g, ' ')}: <strong>{v}</strong></span>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-500">{t('insights.revenueByFee')}</h2>
            {op.revenue_by_fee_type.length === 0 ? (
              <p className="text-sm text-slate-500">{t('insights.noPaidCharges')}</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {op.revenue_by_fee_type.map((r) => (
                  <li key={r.type + r.currency} className="flex items-center justify-between py-2">
                    <span className="flex min-w-0 items-center text-slate-700">
                      <span className="truncate capitalize">{r.type.replace(/_/g, ' ')}</span>
                      <CountPill n={r.count} />
                    </span>
                    <Money amount={r.amount} currency={r.currency} className="ml-4 font-medium text-slate-800" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {gov && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t('insights.govView')}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={t('insights.collections')} value={formatMoneyList(gov.collections)} />
            <Stat label={t('insights.customsCollections')} value={formatMoneyList(gov.customs_collections)} />
            <Stat label={t('insights.inPort')} value={String(gov.congestion_in_port)} />
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-400">{t('insights.arrivals7d')}</p>
            <div className="mt-4 flex items-end gap-3 border-b border-slate-200" style={{ height: 96 }}>
              {gov.arrivals_by_day.map((d) => {
                const max = Math.max(1, ...gov.arrivals_by_day.map((x) => x.count));
                // Real bar for non-zero days; a thin baseline stub for empty days
                // so all 7 columns read as a chart rather than one floating block.
                const barHeight = d.count > 0 ? Math.max(6, (d.count / max) * 64) : 2;
                return (
                  <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className={`text-[11px] font-medium tabular-nums ${d.count > 0 ? 'text-slate-600' : 'text-slate-300'}`}>{d.count}</span>
                    <div
                      className={`w-full rounded-t ${d.count > 0 ? 'bg-sky-500' : 'bg-slate-200'}`}
                      style={{ height: `${barHeight}px` }}
                      title={`${d.count} on ${d.date}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-3">
              {gov.arrivals_by_day.map((d) => (
                <span key={d.date} className="flex-1 text-center text-[10px] text-slate-400">{d.date.slice(5)}</span>
              ))}
            </div>
          </div>
        </section>
      )}
    </Chrome>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
