'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { VerificationTaskSummary } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetchEnvelope, apiFetch } from '../../../../lib/api';
import { formatMoney } from '../../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';

export default function VerificationQueuePage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [rows, setRows] = useState<VerificationTaskSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<VerificationTaskSummary[]>('/verification-tasks?status=open&limit=200', { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setRows(json.data ?? [])))
      .catch(() => setErr('Could not load the queue.'));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (!ready || !auth) return <Loading />;
  const canResolve = auth.permissions.includes('verification:resolve');

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">Verification queue</h1>
      <p className="mt-1 text-sm text-slate-500">
        Low-confidence extracted fields (below the {`0.85`} threshold). These charges are excluded from the payable total until confirmed here.
      </p>
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      <div className="mt-6 space-y-3">
        {rows && rows.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Queue is empty — nothing to review. 🎉
          </div>
        )}
        {rows?.map((t) => (
          <TaskCard key={t.id} task={t} token={token} canResolve={canResolve} onDone={load} />
        ))}
      </div>
    </Chrome>
  );
}

function TaskCard({ task, token, canResolve, onDone }: { task: VerificationTaskSummary; token: string | null; canResolve: boolean; onDone: () => void }) {
  const before = task.before_value as { type?: string; amount?: number; currency?: string } | null;
  const [value, setValue] = useState(before?.amount != null ? String(before.amount) : '');
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    try {
      await apiFetch(`/verification-tasks/${task.id}/resolve`, {
        method: 'POST',
        token,
        body: { field: task.field, corrected_value: Number(value) },
      });
      onDone();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {before?.type ? before.type.replace(/_/g, ' ') : task.field} on{' '}
            <Link href={`/dashboard/containers/${task.container_id}`} className="font-mono text-sky-700 hover:underline">
              {task.container_number}
            </Link>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Extracted value:{' '}
            <span className="font-medium">
              {before?.amount != null ? formatMoney(before.amount, before.currency ?? 'USD') : '—'}
            </span>{' '}
            · confidence <span className="rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700">{task.confidence.toFixed(2)}</span>
          </p>
        </div>
        {canResolve ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">corrected (minor units)</label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button onClick={resolve} disabled={busy} className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
              {busy ? '…' : 'Confirm'}
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-400">read-only</span>
        )}
      </div>
    </div>
  );
}
