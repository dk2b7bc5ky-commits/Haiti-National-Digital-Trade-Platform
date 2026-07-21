'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ContainerDetail } from '@rezo/shared-types';
import { useAuth } from '../../../../lib/auth';
import { apiFetchEnvelope } from '../../../../lib/api';
import { Chrome, Loading, useRequireAuth } from '../../../../components/chrome';

export default function ContainerDetailPage() {
  const { auth, ready } = useRequireAuth();
  const { token } = useAuth();
  const params = useParams();
  const id = params.id as string;
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetchEnvelope<ContainerDetail>(`/containers/${id}`, { token })
      .then(({ json }) => (json.error ? setErr(json.error.message) : setDetail(json.data)))
      .catch(() => setErr('Could not load container.'));
  }, [token, id]);

  if (!ready || !auth) return <Loading />;

  return (
    <Chrome auth={auth}>
      <Link href="/dashboard/containers" className="text-sm text-sky-700 hover:underline">← All containers</Link>

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      {detail && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">{detail.container.container_number}</h1>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
              {detail.container.status}
            </span>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Container">
              <Field label="Container no." value={detail.container.container_number} mono />
              <Field label="Size / type" value={detail.container.size_type} />
              <Field label="Arrival date" value={detail.container.arrival_date ? new Date(detail.container.arrival_date).toLocaleString() : '—'} />
              <Field label="Importer" value={detail.container.importer.legal_name} />
              <Field label="Terminal" value={detail.container.terminal?.legal_name ?? 'Not yet assigned'} />
            </Panel>

            <Panel title="Bill of lading & voyage">
              <Field label="BL number" value={detail.container.bl_number} mono />
              <Field label="Shipper" value={detail.container.shipper} />
              <Field label="Description" value={detail.container.description ?? '—'} />
              <Field label="Vessel" value={`${detail.container.voyage.vessel.name} (IMO ${detail.container.voyage.vessel.imo})`} />
              <Field label="Voyage" value={detail.container.voyage.voyage_number} />
              <Field label="Port / ETA" value={`${detail.container.voyage.port} · ${new Date(detail.container.voyage.eta).toLocaleDateString()}`} />
            </Panel>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Charges">
              <p className="text-sm text-slate-500">
                Charges grouped by payee, totals, and last-free-day tracking arrive in
                build steps 4–6. This container currently has no charges recorded.
              </p>
            </Panel>
            <Panel title="Deadlines">
              <p className="text-sm text-slate-500">
                Last-free-day countdown and alerts arrive in build step 6.
              </p>
            </Panel>
          </div>
        </>
      )}
    </Chrome>
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
