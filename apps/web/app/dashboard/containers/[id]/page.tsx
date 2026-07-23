'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ContainerDetail } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetchEnvelope, apiFetch, ApiClientError } from '../../../../lib/api';
import { apiUpload } from '../../../../lib/api';
import { countdown } from '../../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';
import { PaymentPanel } from '../../../../components/payment-panel';
import { Money, MoneyList, StatusPill, type PillTone } from '../../../../components/ui';

const COUNTDOWN_TONE: Record<string, PillTone> = { ok: 'gray', soon: 'amber', overdue: 'red' };

export default function ContainerDetailPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const params = useParams();
  const id = params.id as string;
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerDetail>(`/containers/${id}`, { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setDetail(json.data)))
      .catch(() => setErr('Could not load container.'));
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const canWrite = auth?.permissions.includes('charge:write');

  async function syncTerminal() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/containers/${id}/charges/sync-terminal`, { method: 'POST', token });
      load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  }

  async function requestInspection() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/containers/${id}/request-inspection`, { method: 'POST', token });
      load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Inspection request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function containerAction(path: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/containers/${id}/${path}`, { method: 'POST', token });
      load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <Link href="/dashboard/containers" className="text-sm text-sky-700 hover:underline">← All containers</Link>
      {err && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {detail && (
        <>
          {(() => {
            const cd = countdown(detail.container.last_free_day);
            return (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-mono text-2xl font-bold">{detail.container.container_number}</h1>
                  <StatusPill status={detail.container.status} />
                  <StatusPill status={detail.container.payment_status} />
                  {cd && <StatusPill tone={COUNTDOWN_TONE[cd.tone]} label={`last free day · ${cd.label}`} />}
                </div>
                {detail.total_owed && (
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Total owed</p>
                    <Money amount={detail.total_owed.amount} currency={detail.total_owed.currency} className="text-2xl font-bold text-slate-900" />
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Container">
              <Field label="Size / type" value={detail.container.size_type} />
              <Field label="Arrival date" value={detail.container.arrival_date ? new Date(detail.container.arrival_date).toLocaleString() : '—'} />
              <Field label="Importer" value={detail.container.importer.legal_name} />
              <Field label="Terminal" value={detail.container.terminal?.legal_name ?? 'Not yet assigned'} />
            </Panel>
            <Panel title="Bill of lading & voyage">
              <Field label="BL number" value={detail.container.bl_number} mono />
              <Field label="Shipper" value={detail.container.shipper} />
              <Field label="Vessel" value={`${detail.container.voyage.vessel.name} (IMO ${detail.container.voyage.vessel.imo})`} />
              <Field label="Voyage / port" value={`${detail.container.voyage.voyage_number} · ${detail.container.voyage.port}`} />
            </Panel>
          </div>

          {/* Lifecycle timeline (spec §2.5) */}
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-500">Status timeline</h3>
              <div className="flex gap-2">
                {auth.permissions.includes('customs:clear') && !detail.container.cleared_at && (
                  <button onClick={() => containerAction('customs-clear')} disabled={busy}
                    className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                    Customs clear
                  </button>
                )}
                {auth.permissions.includes('release:authorize') && !detail.container.released_at && (
                  <button onClick={() => containerAction('authorize-release')} disabled={busy}
                    className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                    Authorize release
                  </button>
                )}
              </div>
            </div>
            <ol className="flex flex-wrap gap-x-2 gap-y-3">
              {detail.timeline.map((s, i) => (
                <li key={s.key} className="flex items-center">
                  <div className="flex flex-col items-center text-center">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${s.reached ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
                      {s.reached ? '✓' : i + 1}
                    </span>
                    <span className={`mt-1 max-w-[7rem] text-xs ${s.reached ? 'font-medium text-slate-700' : 'text-slate-400'}`}>{s.label}</span>
                    {s.at && <span className="text-[10px] text-slate-400">{new Date(s.at).toLocaleDateString()}</span>}
                  </div>
                  {i < detail.timeline.length - 1 && <span className={`mx-1 h-0.5 w-6 ${s.reached ? 'bg-green-400' : 'bg-slate-200'}`} />}
                </li>
              ))}
            </ol>
          </div>

          {/* Charges grouped by payee (spec §1.4) */}
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-500">Charges by payee</h3>
              <div className="flex gap-2">
                {auth.permissions.includes('inspection:request') && (
                  <button
                    onClick={requestInspection}
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Request inspection
                  </button>
                )}
                {canWrite && (
                  <button
                    onClick={syncTerminal}
                    disabled={busy}
                    className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                  >
                    {busy ? 'Syncing…' : 'Sync terminal charges'}
                  </button>
                )}
              </div>
            </div>

            {detail.charge_groups.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">
                No charges yet.{canWrite ? ' Use “Sync terminal charges” to pull them from the terminal (mock).' : ''}
              </p>
            )}

            <div className="space-y-5">
              {detail.charge_groups.map((g) => (
                <div key={g.payee_org_id}>
                  <div className="flex items-end justify-between border-b border-slate-100 pb-1">
                    <div>
                      <span className="text-sm font-semibold text-slate-700">{g.payee_name}</span>
                      {(g.payee_type || g.settlement_hint) && (
                        <span className="ml-2 text-xs text-slate-400">
                          pay to{g.payee_type ? ` ${g.payee_type}` : ''}
                          {g.settlement_hint ? ` · ${g.settlement_hint}` : ''}
                        </span>
                      )}
                    </div>
                    <MoneyList items={g.subtotals} className="text-sm font-semibold text-slate-900" />
                  </div>
                  <table className="mt-2 w-full text-left text-sm">
                    <tbody>
                      {g.charges.map((c) => (
                        <tr key={c.id} className="text-slate-600">
                          <td className="py-1.5">{c.type.replace(/_/g, ' ')}</td>
                          <td className="py-1.5 text-xs text-slate-400">{c.source}</td>
                          <td className="py-1.5">
                            <StatusPill status={c.status} />
                          </td>
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
                <span className="text-sm font-semibold text-slate-500">Total owed</span>
                <MoneyList items={detail.totals_by_currency} className="text-lg font-bold text-slate-900" />
              </div>
            )}
          </div>

          {auth.permissions.includes('payment:create') && (
            <PaymentPanel detail={detail} token={token} onDone={load} />
          )}

          {auth.permissions.includes('document:write') && (
            <DocumentUpload containerId={id} token={token} onDone={load} />
          )}

          {auth.permissions.includes('transport:manage') && (
            <ArrangeTrucking containerId={id} token={token} />
          )}

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-500">Deadlines</h3>
            {detail.deadlines.length === 0 ? (
              <p className="text-sm text-slate-500">No deadlines tracked yet (added when charges carry a last-free-day).</p>
            ) : (
              <div className="space-y-2">
                {detail.deadlines.map((dl) => {
                  const cd = countdown(dl.datetime);
                  return (
                    <div key={dl.id} className="flex items-center justify-between border-b border-slate-50 pb-2 text-sm">
                      <div>
                        <span className="font-medium text-slate-700">{dl.type.replace(/_/g, ' ')}</span>
                        <span className="ml-2 text-slate-400">{dl.payee_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600">{new Date(dl.datetime).toLocaleDateString()}</span>
                        {cd && <StatusPill tone={COUNTDOWN_TONE[cd.tone]} label={cd.label} />}
                      </div>
                    </div>
                  );
                })}
                <p className="pt-1 text-xs text-slate-400">
                  Reminders fire automatically (in-app + email) at {detail.deadlines[0].alert_schedule.join(', ')} days before. See <Link href="/dashboard/alerts" className="text-sky-700 hover:underline">Alerts</Link>.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </Chrome>
  );
}

function DocumentUpload({ containerId, token, onDone }: { containerId: string; token: string | null; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('terminal_invoice');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('container_id', containerId);
      form.append('doc_type', docType);
      const res = await apiUpload<{ charges_created: number; charges_pending_review: number; verification_tasks: number }>(
        '/documents',
        form,
        token,
      );
      setMsg(`Extracted ${res.charges_created} charge(s); ${res.charges_pending_review} need review (→ Ops queue).`);
      setFile(null);
      onDone();
    } catch {
      setMsg('Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-500">Upload document</h3>
      <p className="mb-3 text-xs text-slate-400">
        A terminal invoice or declaration is stored and run through extraction (mock OCR/LLM). Low-confidence fields go to the Ops verification queue and are excluded from the total until confirmed.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="terminal_invoice">Terminal invoice</option>
          <option value="customs_declaration">Customs declaration</option>
          <option value="bill_of_lading">Bill of lading</option>
          <option value="other">Other</option>
        </select>
        <button onClick={submit} disabled={!file || busy} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          {busy ? 'Uploading…' : 'Upload & extract'}
        </button>
      </div>
      {msg && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}

function ArrangeTrucking({ containerId, token }: { containerId: string; token: string | null }) {
  const [truckers, setTruckers] = useState<{ id: string; legal_name: string }[]>([]);
  const [truckerId, setTruckerId] = useState('');
  const [pickup, setPickup] = useState('Port-au-Prince Terminal');
  const [dropoff, setDropoff] = useState('');
  const [price, setPrice] = useState('15000');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ id: string; legal_name: string }[]>('/organizations/directory?type=TRUCKER', { token })
      .then(setTruckers).catch(() => {});
  }, [token]);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/transport-jobs', {
        method: 'POST', token,
        body: { container_id: containerId, trucker_org_id: truckerId || undefined, pickup, dropoff, price: Number(price) },
      });
      setMsg('Transport job created — visible to the trucker under Trucking.');
      setDropoff('');
    } catch (e) {
      setMsg(e instanceof ApiClientError ? e.message : 'Could not create job.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-500">Arrange trucking</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-slate-400">Trucker (optional — open offer if blank)</label>
          <select value={truckerId} onChange={(e) => setTruckerId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Open offer</option>
            {truckers.map((t) => <option key={t.id} value={t.id}>{t.legal_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400">Price (minor units)</label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-400">Pickup</label>
          <input value={pickup} onChange={(e) => setPickup(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-400">Dropoff</label>
          <input value={dropoff} onChange={(e) => setDropoff(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <button onClick={create} disabled={busy || !dropoff} className="mt-3 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
        {busy ? 'Creating…' : 'Create transport job'}
      </button>
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`text-right text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
