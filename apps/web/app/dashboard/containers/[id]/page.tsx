'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ContainerDetail, DocumentSummary } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetchEnvelope, apiFetch, ApiClientError } from '../../../../lib/api';
import { apiUpload } from '../../../../lib/api';
import { countdown } from '../../../../lib/format';
import { useT, countdownLabel, type TFunc } from '../../../../lib/i18n';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';
import { PaymentPanel } from '../../../../components/payment-panel';
import { Money, MoneyList, StatusPill, type PillTone } from '../../../../components/ui';

const COUNTDOWN_TONE: Record<string, PillTone> = { ok: 'gray', soon: 'amber', overdue: 'red' };
const DEADLINE_TEXT: Record<string, string> = { ok: 'text-slate-700', soon: 'text-amber-600', overdue: 'text-red-600' };

// Known release-step keys (per the logistics overview: agency+APN fees →
// documents → AGD customs tax → release). Labels/descriptions are localized
// via the i18n dictionary (`step.<key>.label` / `.desc`).
const STEP_KEYS = new Set(['arrived', 'charges_settled', 'customs_cleared', 'released', 'gate_booked', 'gated_out']);
const stepLabel = (t: TFunc, key: string, fallback: string) => (STEP_KEYS.has(key) ? t(`step.${key}.label`) : fallback);
const stepDesc = (t: TFunc, key: string) => (STEP_KEYS.has(key) ? t(`step.${key}.desc`) : '');

export default function ContainerDetailPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const t = useT();
  const params = useParams();
  const id = params.id as string;
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerDetail>(`/containers/${id}`, { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setDetail(json.data)))
      .catch(() => setErr(t('detail.loadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const canWrite = auth?.permissions.includes('charge:write');

  async function action(path: string, method = 'POST') {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/containers/${id}/${path}`, { method, token });
      load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t('detail.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !auth) return <Loading />;

  const cd = detail ? countdown(detail.container.last_free_day) : null;

  return (
    <Chrome auth={auth}>
      <Link href="/dashboard/containers" className="text-sm text-sky-700 hover:underline">{t('detail.allContainers')}</Link>
      {err && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {detail && (
        <>
          {/* Header card: identity + prominent deadline block */}
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-mono text-2xl font-bold">{detail.container.container_number}</h1>
                  <StatusPill status={detail.container.status} />
                  <StatusPill status={detail.container.payment_status} />
                </div>
                <div className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
                  <Field label={t('detail.bl')} value={detail.container.bl_number} mono />
                  <Field label={t('detail.vesselVoyage')} value={`${detail.container.voyage.vessel.name} · ${detail.container.voyage.voyage_number}`} />
                  <Field label={t('detail.arrival')} value={detail.container.arrival_date ? new Date(detail.container.arrival_date).toLocaleDateString() : '—'} />
                  <Field label={t('detail.port')} value={detail.container.voyage.port} />
                  <Field label={t('detail.importer')} value={detail.container.importer.legal_name} />
                  <Field label={t('detail.terminal')} value={detail.container.terminal?.legal_name ?? t('detail.notAssigned')} />
                </div>
              </div>

              <div className="w-full max-w-[15rem] rounded-lg border border-slate-200 bg-slate-50 p-4 sm:w-auto">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('detail.lastFreeDay')}</p>
                {detail.container.last_free_day ? (
                  <>
                    <p className={`text-lg font-bold ${DEADLINE_TEXT[cd?.tone ?? 'ok']}`}>{new Date(detail.container.last_free_day).toLocaleDateString()}</p>
                    {cd && <p className={`text-sm font-semibold ${DEADLINE_TEXT[cd.tone]}`}>{countdownLabel(cd, t)}</p>}
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">{t('detail.accruesAfter')}</p>
                  </>
                ) : (
                  <p className="text-slate-400">—</p>
                )}
                {detail.total_owed && (
                  <div className="mt-3 border-t border-slate-200 pt-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('common.totalOwed')}</p>
                    <Money amount={detail.total_owed.amount} currency={detail.total_owed.currency} className="text-xl font-bold text-slate-900" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* LEFT / main — everything you owe */}
            <div className="space-y-6 lg:col-span-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-500">{t('detail.everythingYouOwe')}</h3>
                  <div className="flex gap-2">
                    {auth.permissions.includes('inspection:request') && (
                      <button onClick={() => action('request-inspection')} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        {t('detail.requestInspection')}
                      </button>
                    )}
                    {canWrite && (
                      <button onClick={() => action('charges/sync-terminal')} disabled={busy} className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50">
                        {busy ? t('detail.syncing') : t('detail.syncTerminal')}
                      </button>
                    )}
                  </div>
                </div>

                {detail.charge_groups.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-500">
                    {t('detail.noChargesYet')}{canWrite ? t('detail.noChargesHint') : ''}
                  </p>
                )}

                <div className="space-y-5">
                  {detail.charge_groups.map((g) => (
                    <div key={g.payee_org_id}>
                      <div className="flex items-end justify-between border-b border-slate-100 pb-1">
                        <div>
                          <span className="text-sm font-semibold text-slate-700">{g.payee_name}</span>
                          {g.payee_type && <span className="ml-2 text-xs text-slate-400">{t('detail.payTo', { type: t(`ptype.${g.payee_type}`) })}</span>}
                        </div>
                        <MoneyList items={g.subtotals} className="text-sm font-semibold text-slate-900" />
                      </div>
                      <table className="mt-2 w-full text-left text-sm">
                        <tbody>
                          {g.charges.map((c) => (
                            <tr key={c.id} className="text-slate-600">
                              <td className="py-1.5 capitalize">{c.type.replace(/_/g, ' ')}</td>
                              <td className="py-1.5 text-xs text-slate-400">{c.source}</td>
                              <td className="py-1.5"><StatusPill status={c.status} /></td>
                              <td className="py-1.5 text-right font-medium text-slate-800"><Money amount={c.amount} currency={c.currency} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>

                {detail.totals_by_currency.length > 0 && (
                  <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-3">
                    <span className="text-sm font-semibold text-slate-500">{t('common.totalOwed')}</span>
                    <MoneyList items={detail.totals_by_currency} className="text-lg font-bold text-slate-900" />
                  </div>
                )}
              </div>

              {auth.permissions.includes('payment:create') && <PaymentPanel detail={detail} token={token} onDone={load} />}
              {auth.permissions.includes('document:write') && <DocumentUpload containerId={id} token={token} onDone={load} />}
              {auth.permissions.includes('transport:manage') && <ArrangeTrucking containerId={id} token={token} />}
            </div>

            {/* RIGHT rail — who you pay, release progress, deadlines */}
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
                <h3 className="mb-3 text-sm font-semibold text-slate-500">{t('detail.whoYouPay')}</h3>
                {detail.charge_groups.length === 0 ? (
                  <p className="text-sm text-slate-400">{t('detail.noPayees')}</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.charge_groups.map((g) => (
                      <li key={g.payee_org_id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-slate-700">{g.payee_name}</span>
                        <MoneyList items={g.subtotals} className="font-medium text-slate-800" />
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
                  {t('detail.routeStraight')}
                </p>
              </div>

              {/* Release progress — plain-language clearance checklist + blocker */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-500">{t('detail.releaseProgress')}</h3>
                  <div className="flex gap-2">
                    {auth.permissions.includes('customs:clear') && !detail.container.cleared_at && (
                      <button onClick={() => action('customs-clear')} disabled={busy} className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">{t('detail.customsClear')}</button>
                    )}
                    {auth.permissions.includes('release:authorize') && !detail.container.released_at && (
                      <button onClick={() => action('authorize-release')} disabled={busy} className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{t('detail.authorizeRelease')}</button>
                    )}
                  </div>
                </div>

                {(() => {
                  const next = detail.timeline.find((s) => !s.reached);
                  return next ? (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-sm font-semibold text-amber-800">{t('detail.waitingOn', { step: stepLabel(t, next.key, next.label) })}</p>
                      <p className="text-xs text-amber-700">{stepDesc(t, next.key)}</p>
                    </div>
                  ) : (
                    <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
                      {t('detail.deliveredNothing')}
                    </div>
                  );
                })()}

                <ol className="space-y-3">
                  {detail.timeline.map((s) => {
                    const label = stepLabel(t, s.key, s.label);
                    const desc = stepDesc(t, s.key);
                    return (
                      <li key={s.key} className="flex items-start gap-3">
                        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.reached ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-400'}`}>{s.reached ? '✓' : '•'}</span>
                        <div className="min-w-0">
                          <p className={`text-sm ${s.reached ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
                            {label}
                            {s.at && <span className="ml-2 text-xs font-normal text-slate-400">{new Date(s.at).toLocaleDateString()}</span>}
                          </p>
                          <p className="text-xs text-slate-400">{desc}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
                <h3 className="mb-3 text-sm font-semibold text-slate-500">{t('detail.deadlines')}</h3>
                {detail.deadlines.length === 0 ? (
                  <p className="text-sm text-slate-500">{t('detail.noDeadlines')}</p>
                ) : (
                  <div className="space-y-2">
                    {detail.deadlines.map((dl) => {
                      const dcd = countdown(dl.datetime);
                      return (
                        <div key={dl.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                          <div className="min-w-0">
                            <span className="font-medium text-slate-700">{dl.type.replace(/_/g, ' ')}</span>
                            <span className="ml-2 text-xs text-slate-400">{dl.payee_name}</span>
                          </div>
                          {dcd && <StatusPill tone={COUNTDOWN_TONE[dcd.tone]} label={countdownLabel(dcd, t)} />}
                        </div>
                      );
                    })}
                    <p className="pt-1 text-xs text-slate-400">
                      {t('detail.remindersFire', { days: detail.deadlines[0].alert_schedule.join(', ') })}<Link href="/dashboard/alerts" className="text-sky-700 hover:underline">{t('nav.alerts')}</Link>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </Chrome>
  );
}

function DocumentUpload({ containerId, token, onDone }: { containerId: string; token: string | null; onDone: () => void }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('terminal_invoice');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadDocs = useCallback(() => {
    apiFetch<DocumentSummary[]>(`/containers/${containerId}/documents`, { token }).then(setDocs).catch(() => setDocs([]));
  }, [containerId, token]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('container_id', containerId);
      form.append('doc_type', docType);
      const res = await apiUpload<{ charges_created: number; charges_pending_review: number; verification_tasks: number }>('/documents', form, token);
      setMsg(t('doc.extracted', { n: res.charges_created, m: res.charges_pending_review }));
      setFile(null);
      loadDocs();
      onDone();
    } catch {
      setMsg(t('doc.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(id: string) {
    if (!window.confirm(t('doc.removeConfirm'))) return;
    setRemovingId(id);
    setMsg(null);
    try {
      const res = await apiFetch<{ deleted: boolean; charges_removed: number }>(`/documents/${id}`, { method: 'DELETE', token });
      setMsg(t('doc.removed', { n: res.charges_removed }));
      loadDocs();
      onDone();
    } catch {
      setMsg(t('doc.uploadFailed'));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
      <h3 className="mb-3 text-sm font-semibold text-slate-500">{t('doc.title')}</h3>
      <p className="mb-3 text-xs text-slate-400">
        {t('doc.hint')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="terminal_invoice">{t('doc.terminalInvoice')}</option>
          <option value="customs_declaration">{t('doc.customsDeclaration')}</option>
          <option value="bill_of_lading">{t('doc.billOfLading')}</option>
          <option value="other">{t('doc.other')}</option>
        </select>
        <button onClick={submit} disabled={!file || busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {busy ? t('doc.uploading') : t('doc.uploadExtract')}
        </button>
      </div>
      {msg && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{msg}</p>}

      {/* Uploaded documents — remove one to clear the charges it added and redo. */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('doc.uploaded')}</p>
        {docs.length === 0 ? (
          <p className="text-sm text-slate-400">{t('doc.none')}</p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="truncate font-medium text-slate-700">{d.file_name}</span>
                  <span className="ml-2 text-xs text-slate-400">{new Date(d.created_at).toLocaleDateString()}</span>
                </span>
                <button
                  onClick={() => removeDoc(d.id)}
                  disabled={removingId === d.id}
                  className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {removingId === d.id ? t('doc.removing') : t('doc.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ArrangeTrucking({ containerId, token }: { containerId: string; token: string | null }) {
  const tr = useT();
  const [truckers, setTruckers] = useState<{ id: string; legal_name: string }[]>([]);
  const [truckerId, setTruckerId] = useState('');
  const [pickup, setPickup] = useState('Port-au-Prince Terminal');
  const [dropoff, setDropoff] = useState('');
  const [price, setPrice] = useState('15000');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ id: string; legal_name: string }[]>('/organizations/directory?type=TRUCKER', { token }).then(setTruckers).catch(() => {});
  }, [token]);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/transport-jobs', { method: 'POST', token, body: { container_id: containerId, trucker_org_id: truckerId || undefined, pickup, dropoff, price: Number(price) } });
      setMsg(tr('truck.created'));
      setDropoff('');
    } catch (e) {
      setMsg(e instanceof ApiClientError ? e.message : tr('truck.couldNotCreate'));
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
      <h3 className="mb-3 text-sm font-semibold text-slate-500">{tr('truck.title')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-slate-400">{tr('truck.truckerOptional')}</label>
          <select value={truckerId} onChange={(e) => setTruckerId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">{tr('truck.openOffer')}</option>
            {truckers.map((tk) => <option key={tk.id} value={tk.id}>{tk.legal_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400">{tr('truck.priceMinor')}</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-400">{tr('truck.pickup')}</label>
          <input value={pickup} onChange={(e) => setPickup(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-400">{tr('truck.dropoff')}</label>
          <input value={dropoff} onChange={(e) => setDropoff(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <button onClick={create} disabled={busy || !dropoff} className="mt-3 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
        {busy ? tr('truck.creating') : tr('truck.create')}
      </button>
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`truncate text-right text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
