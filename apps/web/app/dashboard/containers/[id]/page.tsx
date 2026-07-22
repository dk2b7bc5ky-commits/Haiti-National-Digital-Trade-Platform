'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ContainerDetail } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetchEnvelope, apiFetch, ApiClientError } from '../../../../lib/api';
import { apiUpload } from '../../../../lib/api';
import { formatMoney, formatMoneyList, countdown, PAYMENT_STATUS_STYLE, COUNTDOWN_STYLE } from '../../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  pending_review: 'bg-orange-100 text-orange-700',
  requested: 'bg-sky-100 text-sky-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
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
                  <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                    {detail.container.status}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PAYMENT_STATUS_STYLE[detail.container.payment_status]}`}>
                    {detail.container.payment_status}
                  </span>
                  {cd && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${COUNTDOWN_STYLE[cd.tone]}`}>
                      last free day · {cd.label}
                    </span>
                  )}
                </div>
                {detail.total_owed && (
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Total owed</p>
                    <p className="text-2xl font-bold text-slate-900">
                      {formatMoney(detail.total_owed.amount, detail.total_owed.currency)}
                    </p>
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

          {/* Charges grouped by payee (spec §1.4) */}
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-500">Charges by payee</h3>
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
                    <span className="text-sm font-semibold text-slate-900">{formatMoneyList(g.subtotals)}</span>
                  </div>
                  <table className="mt-2 w-full text-left text-sm">
                    <tbody>
                      {g.charges.map((c) => (
                        <tr key={c.id} className="text-slate-600">
                          <td className="py-1.5">{c.type.replace(/_/g, ' ')}</td>
                          <td className="py-1.5 text-xs text-slate-400">{c.source}</td>
                          <td className="py-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status] ?? 'bg-slate-100'}`}>{c.status}</span>
                          </td>
                          <td className="py-1.5 text-right font-medium text-slate-800">{formatMoney(c.amount, c.currency)}</td>
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
                <span className="text-lg font-bold text-slate-900">{formatMoneyList(detail.totals_by_currency)}</span>
              </div>
            )}
          </div>

          {auth.permissions.includes('document:write') && (
            <DocumentUpload containerId={id} token={token} onDone={load} />
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
                        {cd && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COUNTDOWN_STYLE[cd.tone]}`}>{cd.label}</span>}
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
