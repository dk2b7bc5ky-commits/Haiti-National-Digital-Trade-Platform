'use client';

import { useEffect, useState } from 'react';
import type { ContainerDetail, PaymentRequestSummary, MarketConfig } from '@rezo/shared-types';
import { apiFetch, ApiClientError } from '../lib/api';
import { formatMoney } from '../lib/format';

const ROUTING_STYLE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  settled: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  reversed: 'bg-slate-200 text-slate-600',
};

function uuid(): string {
  // Browser-native; fine for an idempotency key.
  return crypto.randomUUID();
}

/**
 * Pay flow (spec Flow C): pick a settlement currency, review the per-payee
 * routing + frozen total, authorize once. Rezo routes each portion directly to
 * each payee — it never holds the money.
 */
export function PaymentPanel({ detail, token, onDone }: { detail: ContainerDetail; token: string | null; onDone: () => void }) {
  const containerId = detail.container.id;
  const payable = detail.charges.filter((c) => c.status === 'pending' || c.status === 'overdue');
  const [currencies, setCurrencies] = useState<string[]>(['USD']);
  const [currency, setCurrency] = useState('USD');
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
      <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
        All charges settled — nothing to pay. {detail.total_owed === null && 'Total is fully paid.'}
      </div>
    );
  }

  async function create(chargeIds: string[]): Promise<PaymentRequestSummary> {
    return apiFetch<PaymentRequestSummary>('/payment-requests', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': uuid() },
      body: { container_id: containerId, charge_ids: chargeIds, settlement_currency: currency },
    });
  }

  async function review() {
    setBusy(true); setErr(null);
    try {
      setRequest(await create(payable.map((c) => c.id)));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Could not prepare payment.');
    } finally { setBusy(false); }
  }

  async function authorize() {
    if (!request) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch<PaymentRequestSummary>(`/payment-requests/${request.id}/authorize`, { method: 'POST', token, body: {} });
      setRequest(res);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Authorization failed.');
    } finally { setBusy(false); }
  }

  async function retryFailed() {
    if (!request) return;
    setBusy(true); setErr(null);
    try {
      const fresh = await create(request.failed_charge_ids);
      const res = await apiFetch<PaymentRequestSummary>(`/payment-requests/${fresh.id}/authorize`, { method: 'POST', token, body: {} });
      setRequest(res);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Retry failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-1 text-sm font-semibold text-slate-500">Pay charges</h3>
      <p className="mb-3 text-xs text-slate-400">
        One authorization routes each portion directly to its payee. Rezo never holds the funds; the FX rate is frozen when you authorize.
      </p>

      {!request && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-600">{payable.length} payable charge(s)</span>
          <label className="text-sm text-slate-500">settle in</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={review} disabled={busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
            {busy ? 'Preparing…' : 'Review payment'}
          </button>
        </div>
      )}

      {request && (
        <div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <th className="py-2 font-medium">Pay to</th>
                <th className="py-2 font-medium">FX</th>
                <th className="py-2 text-right font-medium">Amount</th>
                <th className="py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {request.routings.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-700">{r.payee_name}{r.is_rezo_fee && <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-700">Rezo fee</span>}</td>
                  <td className="py-2 text-xs text-slate-400">{r.charge_currency}→{request.settlement_currency} @ {r.fx_rate}</td>
                  <td className="py-2 text-right font-medium text-slate-800">{formatMoney(r.settlement_amount, request.settlement_currency)}</td>
                  <td className="py-2 text-right"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROUTING_STYLE[r.status]}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-sm font-semibold text-slate-500">Total (incl. Rezo fee {formatMoney(request.rezo_fee, request.settlement_currency)})</span>
            <span className="text-lg font-bold text-slate-900">{formatMoney(request.gross_amount_settlement, request.settlement_currency)}</span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {request.status === 'created' && (
              <>
                <button onClick={authorize} disabled={busy} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                  {busy ? 'Authorizing…' : 'Authorize & pay'}
                </button>
                <button onClick={() => setRequest(null)} className="text-sm text-slate-500 hover:underline">Cancel</button>
              </>
            )}
            {request.status !== 'created' && (
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${request.status === 'settled' ? 'bg-green-100 text-green-700' : request.status === 'partially_settled' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                {request.status.replace(/_/g, ' ')}
              </span>
            )}
            {request.failed_charge_ids.length > 0 && (request.status === 'partially_settled' || request.status === 'failed') && (
              <button onClick={retryFailed} disabled={busy} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                Retry {request.failed_charge_ids.length} failed
              </button>
            )}
            {request.release_eligible && <span className="text-sm text-green-700">✓ Ready for release</span>}
          </div>
          {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        </div>
      )}
      {!request && err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </div>
  );
}
