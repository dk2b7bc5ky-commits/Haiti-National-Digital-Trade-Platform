'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ContainerSummary, MarketConfig, ContainerSize, DirectoryOrg } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope, ApiClientError } from '../../../lib/api';
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

/** Importer-friendly "add a container" modal (backed by POST /containers). */
function AddContainerModal({
  token, canPickImporter, onClose, onAdded,
}: {
  token: string | null; canPickImporter: boolean; onClose: () => void; onAdded: () => void;
}) {
  const t = useT();
  const [containerNumber, setContainerNumber] = useState('');
  const [blNumber, setBlNumber] = useState('');
  const [size, setSize] = useState<ContainerSize>('40');
  const [arrival, setArrival] = useState('');
  const [importerId, setImporterId] = useState('');
  const [importers, setImporters] = useState<DirectoryOrg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (canPickImporter) {
      apiFetch<DirectoryOrg[]>('/organizations/directory?type=IMPORTER', { token }).then(setImporters).catch(() => {});
    }
  }, [canPickImporter, token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/containers', {
        method: 'POST',
        token,
        body: {
          container_number: containerNumber.trim(),
          size_type: size,
          bl_number: blNumber.trim() || undefined,
          arrival_date: arrival ? new Date(arrival).toISOString() : undefined,
          importer_org_id: canPickImporter && importerId ? importerId : undefined,
        },
      });
      onAdded();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('containers.addFailed'));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-lg font-bold">{t('containers.addTitle')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('containers.addHint')}</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700">{t('manifest.containerNumber')}</label>
            <input value={containerNumber} onChange={(e) => setContainerNumber(e.target.value)} required placeholder="MSKU1234567" className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">{t('manifest.blNumber')}</label>
            <input value={blNumber} onChange={(e) => setBlNumber(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">{t('containers.size')}</label>
              <select value={size} onChange={(e) => setSize(e.target.value as ContainerSize)} className={inputCls}>
                <option value="20">20&apos;</option>
                <option value="40">40&apos;</option>
                <option value="reefer">Reefer</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">{t('containers.colArrival')}</label>
              <input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} className={inputCls} />
            </div>
          </div>
          {canPickImporter && (
            <div>
              <label className="block text-sm font-medium text-slate-700">{t('containers.importer')}</label>
              <select value={importerId} onChange={(e) => setImporterId(e.target.value)} required className={inputCls}>
                <option value="">{t('manifest.selectImporter')}</option>
                {importers.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
              </select>
            </div>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{t('common.cancel')}</button>
            <button type="submit" disabled={busy || !containerNumber.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {busy ? t('containers.adding') : t('containers.addSave')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ContainersPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const t = useT();
  const [rows, setRows] = useState<ContainerSummary[] | null>(null);
  const [freeDays, setFreeDays] = useState(FREE_DAYS_DEFAULT);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Filters
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState('');
  const [atRiskOnly, setAtRiskOnly] = useState(false);

  const loadContainers = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerSummary[]>('/containers?limit=200', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setRows(json.data ?? [])))
      .catch(() => setErr(t('containers.loadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadContainers();
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
        <div className="flex items-center gap-2">
          {auth.permissions.includes('container:create') && (
            <button onClick={() => setShowAdd(true)} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">
              {t('containers.addContainer')}
            </button>
          )}
          {auth.permissions.includes('manifest:submit') && (
            <Link href="/dashboard/manifests/new" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {t('containers.submitManifest')}
            </Link>
          )}
        </div>
      </div>

      {showAdd && (
        <AddContainerModal
          token={token}
          canPickImporter={auth.permissions.includes('broker:manage') || auth.permissions.includes('tenant:read_all')}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); setRows(null); loadContainers(); }}
        />
      )}
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
