'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary, ContainerDetail, PayeeType } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { formatMoney, formatMoneyList } from '../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';

const STATUS_STYLE: Record<string, string> = {
  none: 'bg-slate-100 text-slate-500',
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
};

const PAYEE_STYLE: Record<string, string> = {
  customs: 'bg-indigo-100 text-indigo-700',
  port: 'bg-sky-100 text-sky-700',
  terminal: 'bg-teal-100 text-teal-700',
  line: 'bg-purple-100 text-purple-700',
  rezo: 'bg-slate-200 text-slate-700',
  other: 'bg-slate-100 text-slate-600',
};

// Charge states that still owe money (paid / in-review are excluded).
const OWED_STATES = new Set(['pending', 'overdue', 'requested']);

interface PayeeOwed {
  payeeOrgId: string;
  name: string;
  type: PayeeType | null;
  totals: Map<string, number>; // currency -> minor units
}

export default function BillingPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [details, setDetails] = useState<ContainerDetail[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const { json } = await apiFetchEnvelope<ContainerSummary[]>('/containers?limit=200', { token });
    const list = json.data ?? [];
    setContainers(list);
    // Pull the payee breakdown only for containers that still owe something.
    const outstanding = list.filter((c) => c.payment_status === 'pending' || c.payment_status === 'overdue');
    const fetched = await Promise.all(
      outstanding.map((c) => apiFetch<ContainerDetail>(`/containers/${c.id}`, { token }).catch(() => null)),
    );
    setDetails(fetched.filter((d): d is ContainerDetail => d !== null));
    setLoaded(true);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (!ready || !auth) return <Loading />;

  const bills = containers.filter((c) => c.payment_status === 'pending' || c.payment_status === 'overdue');

  // Aggregate what's owed to each payee (port, customs, terminal, bank, …).
  const byPayee = new Map<string, PayeeOwed>();
  const totalByCurrency = new Map<string, number>();
  for (const d of details) {
    for (const g of d.charge_groups) {
      for (const c of g.charges) {
        if (!OWED_STATES.has(c.status)) continue;
        const entry = byPayee.get(g.payee_org_id) ?? { payeeOrgId: g.payee_org_id, name: g.payee_name, type: g.payee_type, totals: new Map() };
        entry.totals.set(c.currency, (entry.totals.get(c.currency) ?? 0) + c.amount);
        byPayee.set(g.payee_org_id, entry);
        totalByCurrency.set(c.currency, (totalByCurrency.get(c.currency) ?? 0) + c.amount);
      }
    }
  }
  const payees = [...byPayee.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totalOutstanding = [...totalByCurrency.entries()].map(([currency, amount]) => ({ amount, currency }));
  const overdueCount = bills.filter((c) => c.payment_status === 'overdue').length;

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bills to settle — port dues, customs &amp; agency fees, terminal and bank charges — routed directly to each payee. Trucking is arranged per container.
      </p>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Total outstanding" value={totalOutstanding.length ? formatMoneyList(totalOutstanding) : '—'} />
        <Stat label="Containers with bills" value={String(bills.length)} />
        <Stat label="Overdue" value={String(overdueCount)} tone={overdueCount > 0 ? 'warn' : undefined} />
      </section>

      {loaded && bills.length === 0 && (
        <p className="mt-8 rounded-xl border border-green-200 bg-green-50 px-4 py-6 text-center text-sm text-green-700">
          🎉 No outstanding bills — everything is settled.
        </p>
      )}

      {payees.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Amount owed by payee</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                  <th className="px-4 py-3 font-medium">Payee</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">Amount owed</th>
                </tr>
              </thead>
              <tbody>
                {payees.map((p) => (
                  <tr key={p.payeeOrgId} className="border-b border-slate-50">
                    <td className="px-4 py-3 text-slate-700">{p.name}</td>
                    <td className="px-4 py-3">
                      {p.type && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYEE_STYLE[p.type] ?? PAYEE_STYLE.other}`}>{p.type}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                      {formatMoneyList([...p.totals.entries()].map(([currency, amount]) => ({ amount, currency })))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {bills.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Bills by container</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                  <th className="px-4 py-3 font-medium">Container</th>
                  <th className="px-4 py-3 font-medium">B/L</th>
                  <th className="px-4 py-3 font-medium">Owed</th>
                  <th className="px-4 py-3 font-medium">Last free day</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {bills.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/containers/${c.id}`} className="font-mono font-medium text-sky-700 hover:underline">{c.container_number}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{c.bl_number}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.total_owed ? formatMoney(c.total_owed.amount, c.total_owed.currency) : '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.last_free_day ? new Date(c.last_free_day).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.payment_status]}`}>{c.payment_status}</span></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/containers/${c.id}`} className="text-xs font-semibold text-sky-700 hover:underline">Review &amp; pay →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-500">Container trucking</h2>
        <p className="mt-1 text-sm text-slate-500">
          Book a hauler to move a released container. Arrange trucking from the container&apos;s page.
        </p>
        <Link href="/dashboard/containers" className="mt-3 inline-block rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
          Go to containers →
        </Link>
      </section>
    </Chrome>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
