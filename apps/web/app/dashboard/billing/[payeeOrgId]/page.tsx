'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ContainerDetail, ContainerSummary, PayeeSummary, ChargeSummary } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../../lib/api';
import { useT } from '../../../../lib/i18n';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';
import { Money, MoneyList, StatusPill } from '../../../../components/ui';

const PAYEE_STYLE: Record<string, string> = {
  customs: 'bg-indigo-100 text-indigo-700',
  port: 'bg-sky-100 text-sky-700',
  terminal: 'bg-teal-100 text-teal-700',
  line: 'bg-purple-100 text-purple-700',
  rezo: 'bg-slate-200 text-slate-700',
  other: 'bg-slate-100 text-slate-600',
};
const OWED_STATES = new Set(['pending', 'overdue', 'requested']);

interface OwedContainer {
  id: string;
  number: string;
  lastFreeDay: string | null;
  charges: ChargeSummary[];
  subtotal: Map<string, number>;
}

export default function PayeeBillingPage() {
  const params = useParams<{ payeeOrgId: string }>();
  const payeeOrgId = params.payeeOrgId;
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const t = useT();
  const [payee, setPayee] = useState<PayeeSummary | null>(null);
  const [rows, setRows] = useState<OwedContainer[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    apiFetch<PayeeSummary[]>('/payees', { token })
      .then((list) => setPayee(list.find((p) => p.org_id === payeeOrgId) ?? null))
      .catch(() => {});
    const { json } = await apiFetchEnvelope<ContainerSummary[]>('/containers?limit=200', { token });
    const outstanding = (json.data ?? []).filter((c) => c.payment_status === 'pending' || c.payment_status === 'overdue');
    const details = await Promise.all(
      outstanding.map((c) => apiFetch<ContainerDetail>(`/containers/${c.id}`, { token }).catch(() => null)),
    );
    const owed: OwedContainer[] = [];
    for (const d of details) {
      if (!d) continue;
      const group = d.charge_groups.find((g) => g.payee_org_id === payeeOrgId);
      if (!group) continue;
      const charges = group.charges.filter((c) => OWED_STATES.has(c.status));
      if (charges.length === 0) continue;
      const subtotal = new Map<string, number>();
      for (const c of charges) subtotal.set(c.currency, (subtotal.get(c.currency) ?? 0) + c.amount);
      owed.push({ id: d.container.id, number: d.container.container_number, lastFreeDay: d.container.last_free_day, charges, subtotal });
    }
    setRows(owed);
    setLoaded(true);
  }, [token, payeeOrgId]);

  useEffect(() => { void load(); }, [load]);

  if (!ready || !auth) return <Loading />;

  const grand = new Map<string, number>();
  for (const r of rows) for (const [cur, amt] of r.subtotal) grand.set(cur, (grand.get(cur) ?? 0) + amt);
  const grandList = [...grand.entries()].map(([currency, amount]) => ({ amount, currency }));

  return (
    <Chrome auth={auth}>
      <Link href="/dashboard/billing" className="text-sm text-sky-700 hover:underline">{t('payee.back')}</Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{payee?.name ?? t('payee.fallback')}</h1>
          {payee?.type && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PAYEE_STYLE[payee.type] ?? PAYEE_STYLE.other}`}>{t(`ptype.${payee.type}`)}</span>}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('payee.totalOwedTo')}</p>
          <MoneyList items={grandList} empty="$0.00" className="text-2xl font-bold text-slate-900" />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t('payee.eachContainer')}</p>

      {loaded && rows.length === 0 && (
        <p className="mt-8 rounded-xl border border-green-200 bg-green-50 px-4 py-6 text-center text-sm text-green-700">
          {t('payee.nothingOwed')}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <div className="flex items-center gap-3">
                <Link href={`/dashboard/containers/${r.id}`} className="font-mono font-medium text-sky-700 hover:underline">{r.number}</Link>
                {r.lastFreeDay && <span className="text-xs text-slate-400">{t('payee.lastFreeDayShort', { date: new Date(r.lastFreeDay).toLocaleDateString() })}</span>}
              </div>
              <Link href={`/dashboard/containers/${r.id}`} className="text-xs font-semibold text-sky-700 hover:underline">{t('payee.reviewAndPay')}</Link>
            </div>
            <table className="w-full text-left text-sm">
              <tbody>
                {r.charges.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50">
                    <td className="px-5 py-2 capitalize text-slate-700">{c.type.replace(/_/g, ' ')}</td>
                    <td className="px-5 py-2"><StatusPill status={c.status} /></td>
                    <td className="px-5 py-2 text-right font-medium text-slate-800"><Money amount={c.amount} currency={c.currency} /></td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td className="px-5 py-2 text-xs font-semibold uppercase text-slate-400" colSpan={2}>{t('payee.subtotalTo', { name: payee?.name ?? t('payee.fallback') })}</td>
                  <td className="px-5 py-2 text-right font-bold text-slate-900">
                    <MoneyList items={[...r.subtotal.entries()].map(([currency, amount]) => ({ amount, currency }))} empty="$0.00" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Chrome>
  );
}
