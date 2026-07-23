'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetchEnvelope } from '../../../lib/api';
import { countdown } from '../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { Money, MoneyList, Paid, StatusPill, type PillTone } from '../../../components/ui';

const COUNTDOWN_TONE: Record<string, PillTone> = { ok: 'gray', soon: 'amber', overdue: 'red' };

const SIZE_LABEL: Record<string, string> = { '20': "20'", '40': "40'", reefer: 'Reefer' };

export default function ContainersPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [rows, setRows] = useState<ContainerSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerSummary[]>('/containers?limit=100', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setRows(json.data ?? [])))
      .catch(() => setErr('Could not load containers.'));
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
        One screen per container — charges, who you pay, total owed, and the free-time countdown.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {err && <p className="p-5 text-sm text-red-600">{err}</p>}
        {rows && rows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">No containers visible for your organization yet.</p>
        )}
        {rows && rows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <th className="px-5 py-3 font-medium">Container</th>
                <th className="px-5 py-3 font-medium">Vessel / Voyage</th>
                <th className="px-5 py-3 text-right font-medium">Total owed</th>
                <th className="px-5 py-3 font-medium">Payment</th>
                <th className="px-5 py-3 font-medium">Last free day</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const cd = countdown(c.last_free_day);
                return (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/containers/${c.id}`} className="font-mono font-medium text-sky-700 hover:underline">
                        {c.container_number}
                      </Link>
                      <span className="ml-2 text-xs text-slate-400">{SIZE_LABEL[c.size_type] ?? c.size_type}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {c.voyage.vessel.name} <span className="text-slate-400">· {c.voyage.voyage_number}</span>
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
