'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary, MarketConfig } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { countdown } from '../../../lib/format';
import { useT, countdownLabel } from '../../../lib/i18n';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { Money, MoneyList, Paid, StatusPill, EmptyState, type PillTone } from '../../../components/ui';

const COUNTDOWN_TONE: Record<string, PillTone> = { ok: 'gray', soon: 'amber', overdue: 'red' };

const SIZE_LABEL: Record<string, string> = { '20': "20'", '40': "40'", reefer: 'Reefer' };
const SIZE_STYLE: Record<string, string> = {
  '20': 'bg-slate-100 text-slate-600',
  '40': 'bg-sky-100 text-sky-700',
  reefer: 'bg-teal-100 text-teal-700',
};

// Free-time allowances (days). Config-driven from the market tariff's free_days
// when present, else sensible defaults. Electric (reefer plug-in) applies to reefers.
const FREE_DAYS_DEFAULT = { demurrage: 5, electric: 3 };

const STATUS_OPTS = ['arrived', 'cleared', 'released', 'gated_out'];
const PAY_OPTS = ['pending', 'overdue', 'paid', 'none'];

export default function ContainersPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const t = useT();
  const [rows, setRows] = useState<ContainerSummary[] | null>(null);
  const [freeDays, setFreeDays] = useState(FREE_DAYS_DEFAULT);
  const [err, setErr] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState('');
  const [atRiskOnly, setAtRiskOnly] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerSummary[]>('/containers?limit=200', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setRows(json.data ?? [])))
      .catch(() => setErr(t('containers.loadError')));
    apiFetch<MarketConfig>('/markets/HT', { token })
      .then((m) => {
        const fd = (m.tariff?.free_days ?? {}) as { demurrage?: number; electric?: number };
        setFreeDays({ demurrage: fd.demurrage ?? FREE_DAYS_DEFAULT.demurrage, electric: fd.electric ?? FREE_DAYS_DEFAULT.electric });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (needle && !`${c.container_number} ${c.bl_number} ${c.voyage.vessel.name}`.toLowerCase().includes(needle)) return false;
      if (status && c.status !== status) return false;
      if (pay && c.payment_status !== pay) return false;
      if (atRiskOnly) {
        const cd = countdown(c.last_free_day);
        if (!(cd && cd.days <= 2 && c.status !== 'gated_out')) return false;
      }
      return true;
    });
  }, [rows, q, status, pay, atRiskOnly]);

  const anyFilter = q || status || pay || atRiskOnly;
  const clear = () => { setQ(''); setStatus(''); setPay(''); setAtRiskOnly(false); };

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('containers.title')}</h1>
        {auth.permissions.includes('manifest:submit') && (
          <Link href="/dashboard/manifests/new" className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">
            {t('containers.submitManifest')}
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">{t('containers.subtitle')}</p>

      {/* Filter bar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('containers.searchPlaceholder')}
          className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="">{t('containers.allStatuses')}</option>
          {STATUS_OPTS.map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}
        </select>
        <select value={pay} onChange={(e) => setPay(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="">{t('containers.anyPayment')}</option>
          {PAY_OPTS.map((s) => <option key={s} value={s}>{t(`pay.${s}`)}</option>)}
        </select>
        <label className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${atRiskOnly ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-600'}`}>
          <input type="checkbox" checked={atRiskOnly} onChange={(e) => setAtRiskOnly(e.target.checked)} /> {t('containers.atRiskOnly')}
        </label>
        {anyFilter && <button onClick={clear} className="text-sm text-sky-700 hover:underline">{t('common.clear')}</button>}
        {rows && <span className="ml-auto text-xs text-slate-400">{t('common.ofCount', { a: filtered.length, b: rows.length })}</span>}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-soft">
        {err && <p className="p-5 text-sm text-red-600">{err}</p>}

        {/* Skeleton loading */}
        {!rows && !err && (
          <div className="divide-y divide-slate-50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                <div className="ml-auto h-4 w-20 animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        )}

        {/* Empty states */}
        {rows && rows.length === 0 && (
          <EmptyState title={t('containers.noneTitle')} hint={t('containers.noneHint')} />
        )}
        {rows && rows.length > 0 && filtered.length === 0 && (
          <EmptyState title={t('containers.noMatchTitle')} hint={t('containers.noMatchHint')} />
        )}

        {rows && filtered.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">{t('containers.colContainer')}</th>
                <th className="px-5 py-3 font-medium">{t('containers.colArrival')}</th>
                <th className="px-5 py-3 text-center font-medium">{t('containers.colFreeElectric')}</th>
                <th className="px-5 py-3 text-center font-medium">{t('containers.colFreeDemurrage')}</th>
                <th className="px-5 py-3 text-right font-medium">{t('common.totalOwed')}</th>
                <th className="px-5 py-3 font-medium">{t('containers.colPayment')}</th>
                <th className="px-5 py-3 font-medium">{t('containers.colLastFreeDay')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const cd = countdown(c.last_free_day);
                const isReefer = c.size_type === 'reefer';
                return (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-sky-50/40">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/containers/${c.id}`} className="font-mono font-medium text-sky-700 hover:underline">{c.container_number}</Link>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${SIZE_STYLE[c.size_type] ?? SIZE_STYLE['20']}`}>{SIZE_LABEL[c.size_type] ?? c.size_type}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {c.arrival_date ? new Date(c.arrival_date).toLocaleDateString() : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {isReefer ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚡ {t('containers.days', { n: freeDays.electric })}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">⏳ {t('containers.days', { n: freeDays.demurrage })}</span>
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
                    <td className="px-5 py-3"><StatusPill status={c.payment_status} label={t(`pay.${c.payment_status}`)} /></td>
                    <td className="px-5 py-3">
                      {c.last_free_day ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600">{new Date(c.last_free_day).toLocaleDateString()}</span>
                          {cd && <StatusPill tone={COUNTDOWN_TONE[cd.tone]} label={countdownLabel(cd, t)} />}
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
