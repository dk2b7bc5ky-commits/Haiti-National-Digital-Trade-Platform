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
const DEADLINE_TEXT: Record<string, string> = { ok: 'text-slate-700', soon: 'text-amber-600', overdue: 'text-red-600' };

// Plain-language, Haiti-specific labels for each release step (per the
// logistics overview: agency+APN fees → documents → AGD customs tax → release).
const STEP_INFO: Record<string, { label: string; desc: string }> = {
  arrived: { label: 'Arrived at port', desc: 'Container landed at the terminal.' },
  charges_settled: { label: 'Agency & port fees paid', desc: 'Arrival fees incl. APN port dues settled.' },
  customs_cleared: { label: 'Customs cleared (AGD)', desc: 'Customs tax bill settled and cleared by AGD.' },
  released: { label: 'Release authorized', desc: 'Cleared for pickup once fees and customs are done.' },
  gate_booked: { label: 'Gate appointment', desc: 'Pickup slot booked with the terminal.' },
  gated_out: { label: 'Delivered', desc: 'Container has left the port.' },
};

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

  async function action(path: string, method = 'POST') {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/containers/${id}/${path}`, { method, token });
      load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !auth) return <Loading />;

  const cd = detail ? countdown(detail.container.last_free_day) : null;

  return (
    <Chrome auth={auth}>
      <Link href="/dashboard/containers" className="text-sm text-sky-700 hover:underline">← All containers</Link>
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
                  <Field label="B/L" value={detail.container.bl_number} mono />
                  <Field label="Vessel / voyage" value={`${detail.container.voyage.vessel.name} · ${detail.container.voyage.voyage_number}`} />
                  <Field label="Arrival" value={detail.container.arrival_date ? new Date(detail.container.arrival_date).toLocaleDateString() : '—'} />
                  <Field label="Port" value={detail.container.voyage.port} />
                  <Field label="Importer" value={detail.container.importer.legal_name} />
                  <Field label="Terminal" value={detail.container.terminal?.legal_name ?? 'Not yet assigned'} />
                </div>
              </div>

              <div className="w-full max-w-[15rem] rounded-lg border border-slate-200 bg-slate-50 p-4 sm:w-auto">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Last free day</p>
                {detail.container.last_free_day ? (
                  <>
                    <p className={`text-lg font-bold ${DEADLINE_TEXT[cd?.tone ?? 'ok']}`}>{new Date(detail.container.last_free_day).toLocaleDateString()}</p>
                    {cd && <p className={`text-sm font-semibold ${DEADLINE_TEXT[cd.tone]}`}>{cd.label}</p>}
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">Storage / demurrage begins accruing after this date.</p>
                  </>
                ) : (
                  <p className="text-slate-400">—</p>
                )}
                {detail.total_owed && (
                  <div className="mt-3 border-t border-slate-200 pt-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total owed</p>
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
                  <h3 className="text-sm font-semibold text-slate-500">Everything you owe</h3>
                  <div className="flex gap-2">
                    {auth.permissions.includes('inspection:request') && (
                      <button onClick={() => action('request-inspection')} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        Request inspection
                      </button>
                    )}
                    {canWrite && (
                      <button onClick={() => action('charges/sync-terminal')} disabled={busy} className="rounded-lg border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50">
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
                          {g.payee_type && <span className="ml-2 text-xs text-slate-400">pay to {g.payee_type}</span>}
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
                    <span className="text-sm font-semibold text-slate-500">Total owed</span>
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
                <h3 className="mb-3 text-sm font-semibold text-slate-500">Who you pay</h3>
                {detail.charge_groups.length === 0 ? (
                  <p className="text-sm text-slate-400">No payees yet.</p>
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
                  Rezo routes your payment straight to each party — it never holds the money.
                </p>
              </div>

              {/* Release progress — plain-language clearance checklist + blocker */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-500">Release progress</h3>
                  <div className="flex gap-2">
                    {auth.permissions.includes('customs:clear') && !detail.container.cleared_at && (
                      <button onClick={() => action('customs-clear')} disabled={busy} className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">Customs clear</button>
                    )}
                    {auth.permissions.includes('release:authorize') && !detail.container.released_at && (
                      <button onClick={() => action('authorize-release')} disabled={busy} className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Authorize release</button>
                    )}
                  </div>
                </div>

                {(() => {
                  const next = detail.timeline.find((s) => !s.reached);
                  return next ? (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-sm font-semibold text-amber-800">Waiting on: {STEP_INFO[next.key]?.label ?? next.label}</p>
                      <p className="text-xs text-amber-700">{STEP_INFO[next.key]?.desc}</p>
                    </div>
                  ) : (
                    <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
                      ✓ Delivered — nothing is blocking this container.
                    </div>
                  );
                })()}

                <ol className="space-y-3">
                  {detail.timeline.map((s) => {
                    const info = STEP_INFO[s.key] ?? { label: s.label, desc: '' };
                    return (
                      <li key={s.key} className="flex items-start gap-3">
                        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.reached ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-400'}`}>{s.reached ? '✓' : '•'}</span>
                        <div className="min-w-0">
                          <p className={`text-sm ${s.reached ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
                            {info.label}
                            {s.at && <span className="ml-2 text-xs font-normal text-slate-400">{new Date(s.at).toLocaleDateString()}</span>}
                          </p>
                          <p className="text-xs text-slate-400">{info.desc}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
                <h3 className="mb-3 text-sm font-semibold text-slate-500">Deadlines</h3>
                {detail.deadlines.length === 0 ? (
                  <p className="text-sm text-slate-500">No deadlines tracked yet.</p>
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
                          {dcd && <StatusPill tone={COUNTDOWN_TONE[dcd.tone]} label={dcd.label} />}
                        </div>
                      );
                    })}
                    <p className="pt-1 text-xs text-slate-400">
                      Reminders fire automatically at {detail.deadlines[0].alert_schedule.join(', ')} days before. See <Link href="/dashboard/alerts" className="text-sky-700 hover:underline">Alerts</Link>.
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
      const res = await apiUpload<{ charges_created: number; charges_pending_review: number; verification_tasks: number }>('/documents', form, token);
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
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
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
    apiFetch<{ id: string; legal_name: string }[]>('/organizations/directory?type=TRUCKER', { token }).then(setTruckers).catch(() => {});
  }, [token]);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/transport-jobs', { method: 'POST', token, body: { container_id: containerId, trucker_org_id: truckerId || undefined, pickup, dropoff, price: Number(price) } });
      setMsg('Transport job created — visible to the trucker under Trucking.');
      setDropoff('');
    } catch (e) {
      setMsg(e instanceof ApiClientError ? e.message : 'Could not create job.');
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft">
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`truncate text-right text-slate-800 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
