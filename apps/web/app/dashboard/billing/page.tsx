'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PlanPrice, SubscriptionSummary, BillingSummary, DirectoryOrg } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { formatMoney, formatMoneyList } from '../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-200 text-slate-600',
  expired: 'bg-red-100 text-red-700',
};

export default function BillingPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [plans, setPlans] = useState<PlanPrice[]>([]);
  const [subs, setSubs] = useState<SubscriptionSummary[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [orgs, setOrgs] = useState<DirectoryOrg[]>([]);
  const isAdmin = auth?.permissions.includes('config:manage');

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<PlanPrice[]>('/subscription-plans', { token }).then(setPlans).catch(() => {});
    apiFetchEnvelope<SubscriptionSummary[]>('/subscriptions', { token }).then(({ json }) => setSubs(json.data ?? [])).catch(() => {});
    if (isAdmin) {
      apiFetch<BillingSummary>('/billing/summary', { token }).then(setSummary).catch(() => {});
      apiFetch<DirectoryOrg[]>('/organizations/directory', { token }).then(setOrgs).catch(() => {});
    }
  }, [token, isAdmin]);

  useEffect(() => { load(); }, [load]);

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="mt-1 text-sm text-slate-500">
        Per-transaction Rezo fee (attached to each payment) + subscriptions. All prices come from the market tariff config.
      </p>

      {summary && (
        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Rezo fee collected" value={formatMoneyList(summary.rezo_fee_collected)} />
          <Stat label="Active subscriptions" value={String(summary.active_subscriptions)} />
          <Stat label="Subscription MRR" value={formatMoney(summary.subscription_mrr.amount, summary.subscription_mrr.currency)} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Plans</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <div key={p.plan} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-800">{p.plan.replace(/_/g, ' ')}</p>
              <p className="mt-1 text-sm text-slate-500">
                {formatMoney(p.monthly, p.currency)}/mo · {formatMoney(p.annual, p.currency)}/yr
              </p>
            </div>
          ))}
        </div>
      </section>

      {isAdmin && <CreateSubscription orgs={orgs} plans={plans} token={token} onDone={load} />}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          {isAdmin ? 'All subscriptions' : 'Your subscription'}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <th className="px-4 py-3 font-medium">Org</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Renewal</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No subscriptions.</td></tr>
              )}
              {subs.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="px-4 py-3 text-slate-700">{s.org_name}</td>
                  <td className="px-4 py-3 text-slate-600">{s.plan.replace(/_/g, ' ')} · {s.term}</td>
                  <td className="px-4 py-3 text-slate-800">{formatMoney(s.price, s.currency)}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(s.renewal_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}>{s.status}</span></td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <SubActions id={s.id} status={s.status} token={token} onDone={load} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Chrome>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function CreateSubscription({ orgs, plans, token, onDone }: { orgs: DirectoryOrg[]; plans: PlanPrice[]; token: string | null; onDone: () => void }) {
  const [orgId, setOrgId] = useState('');
  const [plan, setPlan] = useState('small_broker');
  const [term, setTerm] = useState('monthly');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!orgId) return;
    setBusy(true);
    try {
      await apiFetch('/subscriptions', { method: 'POST', token, body: { org_id: orgId, plan, term } });
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-500">New subscription</h2>
      <div className="flex flex-wrap items-center gap-3">
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Select org…</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
        </select>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {plans.map((p) => <option key={p.plan} value={p.plan}>{p.plan.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={term} onChange={(e) => setTerm(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
        <button onClick={create} disabled={!orgId || busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </section>
  );
}

function SubActions({ id, status, token, onDone }: { id: string; status: string; token: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function act(action: 'renew' | 'cancel') {
    setBusy(true);
    try {
      await apiFetch(`/subscriptions/${id}/${action}`, { method: 'POST', token, body: {} });
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <div className="flex gap-2">
      <button onClick={() => act('renew')} disabled={busy} className="text-xs text-sky-700 hover:underline disabled:opacity-50">renew</button>
      {status === 'active' && <button onClick={() => act('cancel')} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-50">cancel</button>}
    </div>
  );
}
