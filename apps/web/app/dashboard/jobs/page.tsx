'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { TransportJobSummary } from '@rezo/shared-types';
import { useAuth } from '../../../lib/auth';
import { apiFetch, apiFetchEnvelope, apiUpload } from '../../../lib/api';
import { formatMoney } from '../../../lib/format';
import { Chrome, Loading, useRequireAuth } from '../../../components/chrome';

const STATUS_STYLE: Record<string, string> = {
  offered: 'bg-sky-100 text-sky-700',
  accepted: 'bg-indigo-100 text-indigo-700',
  in_transit: 'bg-amber-100 text-amber-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-200 text-slate-600',
};

export default function JobsPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const [jobs, setJobs] = useState<TransportJobSummary[]>([]);

  const load = useCallback(() => {
    if (!token) return;
    apiFetchEnvelope<TransportJobSummary[]>('/transport-jobs', { token }).then(({ json }) => setJobs(json.data ?? [])).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <h1 className="text-2xl font-bold">Trucking jobs</h1>
      <p className="mt-1 text-sm text-slate-500">Accept jobs, upload insurance & POD, share GPS, and book a gate appointment.</p>
      <div className="mt-6 space-y-4">
        {jobs.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">No jobs yet.</p>}
        {jobs.map((j) => <JobCard key={j.id} job={j} token={token} onDone={load} />)}
      </div>
    </Chrome>
  );
}

function JobCard({ job, token, onDone }: { job: TransportJobSummary; token: string | null; onDone: () => void }) {
  const [lat, setLat] = useState('18.55');
  const [lng, setLng] = useState('-72.33');
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); onDone(); } finally { setBusy(false); } };
  const upload = (kind: 'insurance' | 'pod', file: File) => act(async () => {
    const form = new FormData();
    form.append('file', file);
    await apiUpload(`/transport-jobs/${job.id}/${kind}`, form, token);
  });

  const active = job.status !== 'cancelled';
  const accepted = job.status === 'accepted' || job.status === 'in_transit' || job.status === 'delivered';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/dashboard/containers/${job.container_id}`} className="font-mono font-medium text-sky-700 hover:underline">{job.container_number}</Link>
          <span className="ml-2 text-sm text-slate-600">{job.pickup} → {job.dropoff}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-800">{formatMoney(job.price, job.currency)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`}>{job.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {active && (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-sm">
          {job.status === 'offered' && (
            <button onClick={() => act(() => apiFetch(`/transport-jobs/${job.id}/accept`, { method: 'POST', token, body: {} }))} disabled={busy}
              className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700 disabled:opacity-50">Accept job</button>
          )}
          {accepted && (
            <>
              <label className="flex items-center gap-1 text-slate-600">
                Insurance {job.insurance_ref ? '✓' : ''}
                <input type="file" className="text-xs" onChange={(e) => e.target.files?.[0] && upload('insurance', e.target.files[0])} />
              </label>
              <label className="flex items-center gap-1 text-slate-600">
                POD {job.pod_ref ? '✓' : ''}
                <input type="file" className="text-xs" onChange={(e) => e.target.files?.[0] && upload('pod', e.target.files[0])} />
              </label>
              <span className="flex items-center gap-1 text-slate-600">
                GPS
                <input value={lat} onChange={(e) => setLat(e.target.value)} className="w-20 rounded border border-slate-300 px-1.5 py-1 text-xs" />
                <input value={lng} onChange={(e) => setLng(e.target.value)} className="w-20 rounded border border-slate-300 px-1.5 py-1 text-xs" />
                <button onClick={() => act(() => apiFetch(`/transport-jobs/${job.id}/gps`, { method: 'POST', token, body: { lat: Number(lat), lng: Number(lng) } }))} disabled={busy}
                  className="rounded bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">set</button>
                {job.gps && <span className="text-xs text-green-700">@ {job.gps.lat}, {job.gps.lng}</span>}
              </span>
              <span className="flex items-center gap-1 text-slate-600">
                Gate slot
                <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-xs" />
                <button onClick={() => slot && act(() => apiFetch('/gate-appointments', { method: 'POST', token, body: { container_id: job.container_id, slot_time: new Date(slot).toISOString() } }))} disabled={busy || !slot}
                  className="rounded bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">book</button>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
