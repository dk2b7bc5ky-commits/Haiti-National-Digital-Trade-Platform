'use client';

import { useEffect, useState } from 'react';
import type { OperationalDashboard, GovernmentDashboard } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { formatMoney, formatMoneyList } from '../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';

export default function InsightsPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
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
      <h1 className="text-2xl font-bold">Dashboards</h1>
      <p className="mt-1 text-sm text-slate-500">Operational read-model from real platform activity{isGov ? ' + government view' : ''}.</p>

      {op && (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Containers" value={String(op.containers_total)} />
            <Stat label="Released" value={String(op.released)} sub={`${op.gated_out} gated out`} />
            <Stat label="Avg clearance" value={op.avg_clearance_days != null ? `${op.avg_clearance_days} d` : '—'} />
            <Stat label="Payments processed" value={String(op.payments_processed)} sub={formatMoneyList(op.amount_processed)} />
          </section>

          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Rezo fee revenue" value={formatMoneyList(op.rezo_fee_revenue)} />
            <Stat label="Deadlines at risk (7d)" value={String(op.deadlines_at_risk)} tone={op.deadlines_at_risk > 0 ? 'warn' : undefined} />
            <div className="sm:col-span-2 lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">Containers by status</p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {Object.entries(op.by_status).map(([k, v]) => (
                  <span key={k} className="rounded-md bg-slate-100 px-2 py-1 text-slate-700">{k.replace(/_/g, ' ')}: <strong>{v}</strong></span>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-500">Revenue by fee type (paid)</h2>
            {op.revenue_by_fee_type.length === 0 ? (
              <p className="text-sm text-slate-500">No paid charges yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-100 text-xs uppercase text-slate-400"><th className="py-2 font-medium">Fee type</th><th className="py-2 font-medium">Count</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
                <tbody>
                  {op.revenue_by_fee_type.map((r) => (
                    <tr key={r.type + r.currency} className="border-b border-slate-50">
                      <td className="py-2 text-slate-700">{r.type.replace(/_/g, ' ')}</td>
                      <td className="py-2 text-slate-500">{r.count}</td>
                      <td className="py-2 text-right font-medium text-slate-800">{formatMoney(r.amount, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {gov && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Government view</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Collections (routed)" value={formatMoneyList(gov.collections)} />
            <Stat label="Customs collections" value={formatMoneyList(gov.customs_collections)} />
            <Stat label="In-port (congestion)" value={String(gov.congestion_in_port)} />
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-400">Arrivals (last 7 days)</p>
            <div className="mt-3 flex items-end gap-2" style={{ height: 80 }}>
              {gov.arrivals_by_day.map((d) => {
                const max = Math.max(1, ...gov.arrivals_by_day.map((x) => x.count));
                return (
                  <div key={d.date} className="flex flex-1 flex-col items-center justify-end">
                    <div className="w-full rounded-t bg-sky-500" style={{ height: `${(d.count / max) * 64}px` }} title={`${d.count}`} />
                    <span className="mt-1 text-[10px] text-slate-400">{d.date.slice(5)}</span>
                  </div>
                );
              })}
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
