'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  MailAutonomy,
  MailIntakeExtracted,
  MailIntakeMessageSummary,
  MailboxConnectionInfo,
  MailIntakeRunSummary,
} from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope } from '../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';
import { Money, EmptyState } from '../../../components/ui';
import { useT } from '../../../lib/i18n';

/**
 * The email agent's screen (ALIZE_AGENT_SCOPE A3).
 *
 * Three jobs: connect the mailbox, show what the agent read, and let a human
 * confirm or reject each one. Deliberately never offers a "pay" action — the
 * agent's output becomes payable, and paying stays on the container/billing
 * screens as a separate human decision.
 */
export default function AgentPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const t = useT();
  const [conn, setConn] = useState<MailboxConnectionInfo | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<MailIntakeMessageSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<MailIntakeRunSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<MailboxConnectionInfo | null>('/mail-intake/connection', { token })
      .then(({ json }) => setConn(json.error ? null : (json.data ?? null)))
      .catch(() => setConn(null));
    apiFetchEnvelope<MailIntakeMessageSummary[]>('/mail-intake/messages?limit=100', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setMsgs(json.data ?? [])))
      .catch(() => setErr(t('agent.loadFailed')));
  }, [token, t]);

  useEffect(() => { load(); }, [load]);

  async function checkNow() {
    setBusy(true);
    setErr(null);
    try {
      const summary = await apiFetch<MailIntakeRunSummary>('/mail-intake/run', { method: 'POST', token, body: {} });
      setRun(summary);
      load();
    } catch {
      setErr(t('agent.checkFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !auth) return <Loading />;
  const canManage = auth.permissions.includes('mail_intake:manage');
  const pending = (msgs ?? []).filter((m) => m.status === 'NEEDS_REVIEW');
  const rest = (msgs ?? []).filter((m) => m.status !== 'NEEDS_REVIEW');

  return (
    <Chrome auth={auth}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('agent.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('agent.intro')}</p>
        </div>
        {canManage && conn && (
          <button
            onClick={checkNow}
            disabled={busy}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-60"
          >
            {busy ? t('agent.checking') : t('agent.checkNow')}
          </button>
        )}
      </div>

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
      {run && (
        <p className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {t('agent.runResult', {
            checked: String(run.checked),
            review: String(run.needsReview),
            ignored: String(run.ignored),
          })}
          {run.failed > 0 && ` · ${t('agent.runFailed', { n: String(run.failed) })}`}
          {run.error && ` · ${run.error}`}
        </p>
      )}

      <ConnectionCard conn={conn} token={token} canManage={canManage} onSaved={load} />

      {/* Needs review — the queue that matters. */}
      <h2 className="mt-8 text-lg font-semibold">{t('agent.needsReview')}</h2>
      <div className="mt-3 space-y-3">
        {pending.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <EmptyState title={t('agent.noneToReview')} hint={t('agent.noneToReviewHint')} />
          </div>
        )}
        {pending.map((m) => (
          <MessageCard key={m.id} msg={m} token={token} canManage={canManage} onDone={load} />
        ))}
      </div>

      {/* Everything else the agent has seen — the audit view. */}
      {rest.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-semibold">{t('agent.history')}</h2>
          <div className="mt-3 space-y-2">
            {rest.map((m) => (
              <MessageCard key={m.id} msg={m} token={token} canManage={canManage} onDone={load} compact />
            ))}
          </div>
        </>
      )}
    </Chrome>
  );
}

/** Connect / configure the watched mailbox. Never asks for a password. */
function ConnectionCard({
  conn, token, canManage, onSaved,
}: {
  conn: MailboxConnectionInfo | null | undefined;
  token: string | null;
  canManage: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const [address, setAddress] = useState('');
  const [autonomy, setAutonomy] = useState<MailAutonomy>('AUTO_CONTAINER');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (conn) {
      setAddress(conn.address);
      setAutonomy(conn.autonomy);
      setActive(conn.active);
    }
  }, [conn]);

  if (conn === undefined) return <div className="mt-6 h-24 animate-pulse rounded-xl bg-slate-100" />;

  async function save() {
    setBusy(true);
    try {
      await apiFetch('/mail-intake/connection', {
        method: 'PUT', token,
        body: { address, autonomy, active },
      });
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setTest(null);
    try {
      setTest(await apiFetch<{ ok: boolean; error?: string }>('/mail-intake/connection/test', { method: 'POST', token, body: {} }));
    } catch {
      setTest({ ok: false, error: t('agent.testFailed') });
    } finally {
      setBusy(false);
    }
  }

  const showForm = editing || !conn;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{t('agent.mailbox')}</h2>
          {conn ? (
            <p className="mt-1 text-sm text-slate-600">
              <span className="font-mono">{conn.address}</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${conn.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                {conn.active ? t('agent.watching') : t('agent.paused')}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">{t('agent.notConnected')}</p>
          )}
        </div>
        {canManage && conn && !showForm && (
          <div className="flex gap-2">
            <button onClick={runTest} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
              {t('agent.testConnection')}
            </button>
            <button onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
              {t('agent.edit')}
            </button>
          </div>
        )}
      </div>

      {/* Setup state: tell them exactly what's missing, in plain language. */}
      {conn && !conn.secret_present && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('agent.needSecret', { env: conn.secret_env_var })}
        </p>
      )}
      {conn && conn.secret_present && !conn.scheduler_enabled && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t('agent.schedulerOff')}
        </p>
      )}
      {conn?.last_error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{conn.last_error}</p>
      )}
      {test && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${test.ok ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-red-200 bg-red-50 text-red-800'}`}>
          {test.ok ? t('agent.testOk') : test.error}
        </p>
      )}
      {conn?.last_checked_at && !showForm && (
        <p className="mt-3 text-xs text-slate-500">
          {t('agent.lastChecked', { when: new Date(conn.last_checked_at).toLocaleString() })}
        </p>
      )}

      {showForm && canManage && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{t('agent.address')}</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="traffic@yourcompany.com"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">{t('agent.autonomy')}</span>
            <select
              value={autonomy}
              onChange={(e) => setAutonomy(e.target.value as MailAutonomy)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="REVIEW_ALL">{t('agent.autoReviewAll')}</option>
              <option value="AUTO_CONTAINER">{t('agent.autoContainer')}</option>
              <option value="AUTO_ALL">{t('agent.autoAll')}</option>
            </select>
          </label>
          <p className="text-xs text-slate-500 sm:col-span-2">{t('agent.autonomyHint')}</p>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
            <span className="text-slate-700">{t('agent.activeLabel')}</span>
          </label>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2">
            {t('agent.passwordNote')}
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <button onClick={save} disabled={busy || !address} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
              {busy ? t('agent.saving') : t('agent.save')}
            </button>
            {conn && (
              <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  NEEDS_REVIEW: 'bg-amber-100 text-amber-900',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  PROCESSED: 'bg-emerald-100 text-emerald-800',
  IGNORED: 'bg-slate-100 text-slate-600',
  REJECTED: 'bg-slate-100 text-slate-600',
  FAILED: 'bg-red-100 text-red-800',
  PENDING: 'bg-slate-100 text-slate-600',
};

/** One email: what it was, what the agent read, and the two human actions. */
function MessageCard({
  msg, token, canManage, onDone, compact,
}: {
  msg: MailIntakeMessageSummary;
  token: string | null;
  canManage: boolean;
  onDone: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const ex = msg.extracted as MailIntakeExtracted | null;

  async function act(action: 'confirm' | 'reject') {
    if (action === 'reject' && !window.confirm(t('agent.rejectConfirm'))) return;
    setBusy(true);
    try {
      await apiFetch(`/mail-intake/messages/${msg.id}/${action}`, { method: 'POST', token, body: {} });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{msg.subject}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {msg.from_address} · {new Date(msg.received_at).toLocaleString()}
            {msg.attachment_count > 0 && ` · ${t('agent.attachments', { n: String(msg.attachment_count) })}`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[msg.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {t(`agent.status.${msg.status}`)}
        </span>
      </div>

      {/* Why the agent acted or skipped — keeps it honest and debuggable. */}
      {msg.classification && !compact && (
        <p className="mt-2 text-xs italic text-slate-500">{msg.classification}</p>
      )}
      {msg.error && <p className="mt-2 text-xs text-red-600">{msg.error}</p>}

      {/* What it read. */}
      {ex && !compact && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
            {ex.container_number && (
              <span>
                {t('agent.container')}:{' '}
                {msg.container_id ? (
                  <Link href={`/dashboard/containers/${msg.container_id}`} className="font-mono font-semibold text-sky-700 hover:underline">
                    {ex.container_number}
                  </Link>
                ) : (
                  <span className="font-mono font-semibold">{ex.container_number}</span>
                )}
                {ex.container_created && ` (${t('agent.createdByAgent')})`}
              </span>
            )}
            {ex.bl_number && <span>{t('agent.bl')}: <span className="font-mono">{ex.bl_number}</span></span>}
            {msg.confidence != null && <span>{t('agent.confidence')}: {Math.round(msg.confidence * 100)}%</span>}
          </div>

          {ex.charges.length > 0 && (
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-1 font-medium">{t('agent.charge')}</th>
                  <th className="pb-1 text-right font-medium">{t('agent.amount')}</th>
                  <th className="pb-1 text-right font-medium">{t('agent.confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {ex.charges.map((c, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="py-1 capitalize text-slate-700">{c.type.replace(/_/g, ' ')}</td>
                    <td className="py-1 text-right"><Money amount={c.amount} currency={c.currency} /></td>
                    <td className="py-1 text-right text-slate-500">{Math.round(c.confidence * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {canManage && msg.status === 'NEEDS_REVIEW' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => act('confirm')} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {t('agent.confirm')}
          </button>
          <button onClick={() => act('reject')} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
            {t('agent.reject')}
          </button>
          <span className="self-center text-xs text-slate-500">{t('agent.confirmHint')}</span>
        </div>
      )}
    </div>
  );
}
