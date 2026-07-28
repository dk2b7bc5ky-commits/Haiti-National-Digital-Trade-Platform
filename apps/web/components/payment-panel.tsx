'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ContainerDetail, PaymentRequestSummary, MarketConfig, Money as MoneyT } from '@rezo/shared-types';
import { apiFetch, ApiClientError } from '../lib/api';
import { formatMoney } from '../lib/format';
import { Money, MoneyList, StatusPill } from './ui';

function uuid(): string {
  return crypto.randomUUID();
}

type Step = 'review' | 'method' | 'confirm' | 'done';

const METHODS = [
  { id: 'bank_transfer', label: 'Bank transfer', desc: 'Direct bank-to-bank (mock rail)' },
  { id: 'card', label: 'Card', desc: 'Debit or credit (mock)' },
  { id: 'local_rail', label: 'Local rail / mobile money', desc: 'Domestic settlement (mock)' },
];

/**
 * Pay flow (spec Flow C / design brief §4.5): three calm steps —
 * Review → Method → Confirm — ending in a receipt. One authorization routes
 * each portion directly to its payee; Rezo never holds the money. The Rezo
 * service fee is not surfaced in the UI.
 */
export function PaymentPanel({ detail, token, onDone }: { detail: ContainerDetail; token: string | null; onDone: () => void }) {
  const containerId = detail.container.id;
  const payable = useMemo(() => detail.charges.filter((c) => c.status === 'pending' || c.status === 'overdue'), [detail.charges]);
  const reviewGroups = useMemo(
    () =>
      detail.charge_groups
        .map((g) => ({ name: g.payee_name, charges: g.charges.filter((c) => c.status === 'pending' || c.status === 'overdue') }))
        .filter((g) => g.charges.length > 0),
    [detail.charge_groups],
  );
  const payableTotal = useMemo<MoneyT[]>(() => {
    const m = new Map<string, number>();
    for (const c of payable) m.set(c.currency, (m.get(c.currency) ?? 0) + c.amount);
    return [...m.entries()].map(([currency, amount]) => ({ amount, currency }));
  }, [payable]);

  const [currencies, setCurrencies] = useState<string[]>(['USD']);
  const [currency, setCurrency] = useState('USD');
  const [step, setStep] = useState<Step>('review');
  const [method, setMethod] = useState('bank_transfer');
  const [request, setRequest] = useState<PaymentRequestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<MarketConfig>('/markets/HT', { token })
      .then((m) => { setCurrencies(m.currencies); setCurrency(m.base_currency); })
      .catch(() => {});
  }, [token]);

  if (payable.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800 shadow-soft">
        ✓ All charges settled — nothing to pay.
      </div>
    );
  }

  // Total to display, excluding the (hidden) Rezo service fee.
  const displayTotal = (r: PaymentRequestSummary): MoneyT => ({ amount: r.gross_amount_settlement - r.rezo_fee, currency: r.settlement_currency });
  const payRoutings = (r: PaymentRequestSummary) => r.routings.filter((x) => !x.is_rezo_fee);

  async function toMethod() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<PaymentRequestSummary>('/payment-requests', {
        method: 'POST', token, headers: { 'Idempotency-Key': uuid() },
        body: { container_id: containerId, charge_ids: payable.map((c) => c.id), settlement_currency: currency },
      });
      setRequest(r);
      setStep('method');
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Could not prepare payment.');
    } finally { setBusy(false); }
  }

  async function pay() {
    if (!request) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<PaymentRequestSummary>(`/payment-requests/${request.id}/authorize`, { method: 'POST', token, body: {} });
      setRequest(r);
      setStep('done');
      onDone();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Payment failed.');
    } finally { setBusy(false); }
  }

  function downloadReceipt(r: PaymentRequestSummary) {
    const lines = [
      'REZO — PAYMENT RECEIPT',
      `Reference: ${r.id}`,
      `Container: ${detail.container.container_number}`,
      `Status:    ${r.status}`,
      `Method:    ${METHODS.find((m) => m.id === method)?.label ?? method}`,
      '',
      'Routed directly to each payee:',
      ...payRoutings(r).map((x) => `  ${x.payee_name.padEnd(28)} ${formatMoney(x.settlement_amount, r.settlement_currency)}  [${x.status}]`),
      '',
      `TOTAL: ${formatMoney(displayTotal(r).amount, r.settlement_currency)}`,
      '',
      'Rezo routes payments directly payer → payee. Rezo never holds funds.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([lines], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `rezo-receipt-${detail.container.container_number}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-500">Pay charges</h3>
        {step !== 'done' && <Stepper step={step} />}
      </div>

      {/* STEP 1 — Review */}
      {step === 'review' && (
        <div>
          <p className="mb-3 text-xs text-slate-400">One authorization routes each portion directly to its payee. Rezo never holds the funds; the FX rate is frozen when you pay.</p>
          <div className="space-y-3">
            {reviewGroups.map((g) => (
              <div key={g.name} className="flex items-center justify-between border-b border-slate-50 pb-2">
                <span className="text-sm text-slate-700">{g.name}<span className="ml-2 text-xs text-slate-400">{g.charges.length} charge(s)</span></span>
                <MoneyList items={sumMoney(g.charges)} className="text-sm font-medium text-slate-800" />
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-500">Settle in</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">Total</span>
              <MoneyList items={payableTotal} className="text-lg font-bold text-slate-900" />
              <button onClick={toMethod} disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                {busy ? 'Preparing…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 — Method */}
      {step === 'method' && request && (
        <div>
          <p className="mb-3 text-sm text-slate-500">Choose how to pay.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {METHODS.map((m) => (
              <button key={m.id} onClick={() => setMethod(m.id)} className={`rounded-xl border p-4 text-left transition-colors ${method === m.id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500' : 'border-slate-200 hover:bg-slate-50'}`}>
                <p className="text-sm font-semibold text-slate-800">{m.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{m.desc}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
            <button onClick={() => setStep('review')} className="text-sm text-slate-500 hover:underline">← Back</button>
            <div className="flex items-center gap-3">
              <MoneyList items={[displayTotal(request)]} className="text-lg font-bold text-slate-900" />
              <button onClick={() => setStep('confirm')} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3 — Confirm */}
      {step === 'confirm' && request && (
        <div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">Paying</span>
              <MoneyList items={[displayTotal(request)]} className="text-2xl font-bold text-slate-900" />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {payRoutings(request).length} payee(s) · {METHODS.find((m) => m.id === method)?.label} · routed directly to each party
            </p>
          </div>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div className="mt-4 flex items-center justify-between">
            <button onClick={() => setStep('method')} disabled={busy} className="text-sm text-slate-500 hover:underline">← Back</button>
            <button onClick={pay} disabled={busy} className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
              {busy ? 'Paying…' : `Pay ${formatMoney(displayTotal(request).amount, request.settlement_currency)}`}
            </button>
          </div>
        </div>
      )}

      {/* Receipt */}
      {step === 'done' && request && (
        <Receipt request={request} method={method} routings={payRoutings(request)} total={displayTotal(request)} onDownload={() => downloadReceipt(request)} />
      )}
    </div>
  );
}

function Receipt({
  request, method, routings, total, onDownload,
}: {
  request: PaymentRequestSummary; method: string;
  routings: PaymentRequestSummary['routings']; total: MoneyT; onDownload: () => void;
}) {
  const ok = request.status === 'settled';
  return (
    <div>
      <div className={`flex items-center gap-3 rounded-xl border p-4 ${ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-lg text-white ${ok ? 'bg-green-600' : 'bg-amber-500'}`}>{ok ? '✓' : '!'}</span>
        <div>
          <p className={`font-semibold ${ok ? 'text-green-800' : 'text-amber-800'}`}>{ok ? 'Payment sent' : 'Partially settled'}</p>
          <p className="text-xs text-slate-500">Reference {request.id.slice(0, 8)}</p>
        </div>
        <div className="ml-auto text-right">
          <Money amount={total.amount} currency={total.currency} className="text-xl font-bold text-slate-900" />
        </div>
      </div>

      <table className="mt-4 w-full text-left text-sm">
        <thead><tr className="border-b border-slate-100 text-xs uppercase text-slate-400"><th className="py-2 font-medium">Paid to</th><th className="py-2 text-right font-medium">Amount</th><th className="py-2 text-right font-medium">Status</th></tr></thead>
        <tbody>
          {routings.map((r) => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="py-2 text-slate-700">{r.payee_name}</td>
              <td className="py-2 text-right font-medium text-slate-800"><Money amount={r.settlement_amount} currency={request.settlement_currency} /></td>
              <td className="py-2 text-right"><StatusPill status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-slate-400">Sent directly to each payee — Rezo never held the money.</p>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={onDownload} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Download receipt</button>
        <span className="text-xs text-slate-400">Method: {METHODS.find((m) => m.id === method)?.label ?? method}</span>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'review', label: 'Review' },
    { key: 'method', label: 'Method' },
    { key: 'confirm', label: 'Confirm' },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {steps.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 font-medium ${i === idx ? 'bg-sky-600 text-white' : i < idx ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'}`}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-slate-300">›</span>}
        </span>
      ))}
    </div>
  );
}

function sumMoney(charges: { amount: number; currency: string }[]): MoneyT[] {
  const m = new Map<string, number>();
  for (const c of charges) m.set(c.currency, (m.get(c.currency) ?? 0) + c.amount);
  return [...m.entries()].map(([currency, amount]) => ({ amount, currency }));
}
