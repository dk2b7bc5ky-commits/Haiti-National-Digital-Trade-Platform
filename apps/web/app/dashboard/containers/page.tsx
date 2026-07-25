'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary, MarketConfig } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { countdown } from '../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { Money, MoneyList, Paid, StatusPill, type PillTone } from '../../../components/ui';

const COUNTDOWN_TONE: Record<string, PillTone> = { ok: 'gray', soon: 'amber', overdue: 'red' };

const SIZE_LABEL: Record<string, string> = { '20': "20'", '40': "40'", reefer: 'Reefer' };
const SIZE_STYLE: Record<string, string> = {
  '20': 'bg-slate-100 text-slate-600',
  '40': 'bg-sky-100 text-sky-700',
  reefer: 'bg-teal-100 text-teal-700',
};

// Free-time allowances (days). Config-driven: read from the market tariff's
// `free_days` when present, else these sensible defaults. Electric (reefer
// plug-in power) free days only apply to reefer containers.
const FREE_DAYS_DEFAULT = { demurrage: 5, electric: 3 };

export default function ContainersPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [rows, setRows] = useState<ContainerSummary[] | null>(null);
  const [freeDays, setFreeDays] = useState(FREE_DAYS_DEFAULT);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerSummary[]>('/containers?limit=100', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setRows(json.data ?? [])))
      .catch(() => setErr('Could not load containers.'));
    apiFetch<MarketConfig>('/markets/HT', { token })
      .then((m) => {
        const fd = (m.tariff?.free_days ?? {}) as { demurrage?: number; electric?: number };
        setFreeDays({ demurrage: fd.demurrage ?? FREE_DAYS_DEFAULT.demurrage, electric: fd.electric ?? FREE_DAYS_DEFAULT.electric });
      })
      .catch(() => {});
  }, [token]);

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Containers</h1>
        {auth.permissions.includes('manifest:submit') && (
          <Link href="/dashboard/manifests/new" className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">
            + Submit manifest
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        One screen per container — arrival, free time, total owed, and the last-free-day countdown.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {err && <p className="p-5 text-sm text-red-600">{err}</p>}
        {rows && rows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">No containers visible for your organization yet.</p>
        )}
        {rows && rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Container</th>
                <th className="px-5 py-3 font-medium">Arrival date</th>
                <th className="px-5 py-3 text-center font-medium">Free electric</th>
                <th className="px-5 py-3 text-center font-medium">Free demurrage</th>
                <th className="px-5 py-3 text-right font-medium">Total owed</th>
                <th className="px-5 py-3 font-medium">Payment</th>
                <th className="px-5 py-3 font-medium">Last free day</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const cd = countdown(c.last_free_day);
                const isReefer = c.size_type === 'reefer';
                return (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-sky-50/40">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/containers/${c.id}`} className="font-mono font-medium text-sky-700 hover:underline">
                        {c.container_number}
                      </Link>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${SIZE_STYLE[c.size_type] ?? SIZE_STYLE['20']}`}>
                        {SIZE_LABEL[c.size_type] ?? c.size_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {c.arrival_date ? new Date(c.arrival_date).toLocaleDateString() : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {isReefer ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚡ {freeDays.electric} days</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">⏳ {freeDays.demurrage} days</span>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800">
                      {c.total_owed ? (
                        <Money amount={c.total_owed.amount} currency={c.total_owed.currency} />
                      ) : c.payment_status === 'paid' ? (
                        <Paid />
                      ) : (
                        <MoneyList items={[]} empty="$0.00" />
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={c.payment_status} />
                    </td>
                    <td className="px-5 py-3">
                      {c.last_free_day ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600">{new Date(c.last_free_day).toLocaleDateString()}</span>
                          {cd && <StatusPill tone={COUNTDOWN_TONE[cd.tone]} label={cd.label} />}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Chrome>
  );
}
