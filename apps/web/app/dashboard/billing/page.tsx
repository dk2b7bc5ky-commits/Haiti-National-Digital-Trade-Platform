'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary, ContainerDetail, PayeeType, PayeeSummary } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { formatMoneyList } from '../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { MoneyList } from '../../../components/ui';

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
  const [registry, setRegistry] = useState<PayeeSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    // Full payee/agent registry (customs, port, terminal, banks, shipping agents…).
    apiFetch<PayeeSummary[]>('/payees', { token }).then(setRegistry).catch(() => setRegistry([]));
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
  const totalOutstanding = [...totalByCurrency.entries()].map(([currency, amount]) => ({ amount, currency }));
  const overdueCount = bills.filter((c) => c.payment_status === 'overdue').length;

  // One row per payee/agent. Use the full registry when available (so every
  // agent shows, even at zero owed); otherwise fall back to only those owed.
  // The Rezo platform fee is never shown to users.
  const payeeRows = (registry.length > 0
    ? registry.filter((r) => r.type !== 'rezo').map((r) => ({ key: r.org_id, name: r.name, type: r.type, totals: byPayee.get(r.org_id)?.totals ?? new Map<string, number>() }))
    : [...byPayee.values()].filter((p) => p.type !== 'rezo').map((p) => ({ key: p.payeeOrgId, name: p.name, type: p.type, totals: p.totals }))
  ).sort((a, b) => {
    const av = [...a.totals.values()].reduce((s, n) => s + n, 0);
    const bv = [...b.totals.values()].reduce((s, n) => s + n, 0);
    return bv !== av ? bv - av : a.name.localeCompare(b.name);
  });

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

      {payeeRows.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Amount owed by payee / agent</h2>
          <p className="mb-2 text-xs text-slate-400">Click a payee to see each container and exactly what&apos;s owed to them.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                  <th className="px-4 py-3 font-medium">Payee / agent</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">Amount owed</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {payeeRows.map((p) => {
                  const entries = [...p.totals.entries()].map(([currency, amount]) => ({ amount, currency }));
                  const owes = entries.length > 0;
                  return (
                    <tr key={p.key} className={`border-b border-slate-50 ${owes ? 'hover:bg-sky-50/40' : ''}`}>
                      <td className="px-4 py-3">
                        {owes ? (
                          <Link href={`/dashboard/billing/${p.key}`} className="font-medium text-sky-700 hover:underline">{p.name}</Link>
                        ) : (
                          <span className="text-slate-400">{p.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.type && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYEE_STYLE[p.type] ?? PAYEE_STYLE.other}`}>{p.type}</span>}
                      </td>
                      <td className={`px-4 py-3 text-right ${owes ? 'font-medium text-slate-800' : ''}`}>
                        <MoneyList items={entries} empty="$0.00" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {owes && <Link href={`/dashboard/billing/${p.key}`} className="text-xs font-semibold text-sky-700 hover:underline">View →</Link>}
                      </td>
                    </tr>
                  );
                })}
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
